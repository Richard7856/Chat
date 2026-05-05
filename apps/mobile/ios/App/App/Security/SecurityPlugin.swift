import Capacitor
import UIKit

/**
 * iOS analog del SecurityPlugin de Android.
 *
 * IMPORTANTE — iOS NO permite bloquear capturas a nivel OS como Android
 * (FLAG_SECURE). Lo único que la API pública permite:
 *
 *   1. Detectar que el usuario tomó un screenshot — UIApplicationUserDidTakeScreenshotNotification.
 *      Es POST-FACTUM (la captura ya se tomó), pero podemos:
 *        - Notificar al backend (audit log) que registre quién + cuándo.
 *        - Mostrar un alert al usuario "captura registrada".
 *
 *   2. Detectar que la pantalla está siendo grabada o casteada —
 *      UIScreen.capturedDidChangeNotification + UIScreen.main.isCaptured.
 *      Permite OCULTAR la UI (overlay negro) mientras dura la grabación.
 *
 * Por compatibilidad con el JS bridge (`setFlagSecure({ value: bool })`),
 * mantenemos la misma firma. Cuando value=true, este plugin:
 *  - Empieza a observar las notificaciones de screenshot/screen-recording
 *  - Coloca un overlay negro sobre la ventana cuando isCaptured == true
 *  - Reporta screenshots vía un evento Capacitor que el JS escucha
 *
 * Cuando value=false, deja de observar y remueve el overlay.
 *
 * Nota legal: a diferencia de Android, en iOS no existe vía pública para
 * BLOQUEAR la captura ni el screen recording — solo detectarlos. Apple
 * reserva esa capacidad para apps específicas (Apple Pay, FairPlay, etc.)
 * mediante APIs privadas que no pasan App Store review.
 */
@objc(SecurityPlugin)
public class SecurityPlugin: CAPPlugin {

    private var screenshotObserver: NSObjectProtocol?
    private var captureObserver: NSObjectProtocol?
    private var blackOverlay: UIView?
    private var protectionEnabled: Bool = false

    @objc func setFlagSecure(_ call: CAPPluginCall) {
        let value = call.getBool("value") ?? false

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            if value {
                self.startProtection()
            } else {
                self.stopProtection()
            }

            self.protectionEnabled = value
            call.resolve([
                "value": value,
                "platformLimitations": [
                    "blocksScreenshots": false,    // iOS no permite bloquear, solo detectar
                    "blocksScreenRecording": true, // overlay negro mientras se graba
                    "detectsScreenshots": true,    // notifica al user / backend
                ]
            ])
        }
    }

    private func startProtection() {
        let nc = NotificationCenter.default

        // Detectar screenshot (post-factum)
        if screenshotObserver == nil {
            screenshotObserver = nc.addObserver(
                forName: UIApplication.userDidTakeScreenshotNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.notifyListeners("screenshotDetected", data: [
                    "timestamp": ISO8601DateFormatter().string(from: Date())
                ])
            }
        }

        // Detectar screen recording → overlay negro
        if captureObserver == nil {
            captureObserver = nc.addObserver(
                forName: UIScreen.capturedDidChangeNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.updateOverlayIfNeeded()
            }
        }

        // Si ya está siendo capturada al activar, mostrar overlay inmediato
        updateOverlayIfNeeded()
    }

    private func stopProtection() {
        let nc = NotificationCenter.default
        if let o = screenshotObserver {
            nc.removeObserver(o)
            screenshotObserver = nil
        }
        if let o = captureObserver {
            nc.removeObserver(o)
            captureObserver = nil
        }
        removeOverlay()
    }

    private func updateOverlayIfNeeded() {
        let isCaptured = UIScreen.main.isCaptured
        if isCaptured && protectionEnabled {
            showOverlay()
        } else {
            removeOverlay()
        }
    }

    private func showOverlay() {
        guard blackOverlay == nil,
              let window = UIApplication.shared.windows.first(where: { $0.isKeyWindow })
        else { return }

        let overlay = UIView(frame: window.bounds)
        overlay.backgroundColor = .black
        overlay.translatesAutoresizingMaskIntoConstraints = false
        overlay.isUserInteractionEnabled = false

        // Mensaje en blanco para que el atacante sepa que algo bloqueó la captura
        let label = UILabel()
        label.text = "Contenido protegido — grabación bloqueada"
        label.textColor = .white
        label.textAlignment = .center
        label.font = .systemFont(ofSize: 14, weight: .medium)
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false

        overlay.addSubview(label)
        window.addSubview(overlay)

        NSLayoutConstraint.activate([
            overlay.topAnchor.constraint(equalTo: window.topAnchor),
            overlay.leadingAnchor.constraint(equalTo: window.leadingAnchor),
            overlay.trailingAnchor.constraint(equalTo: window.trailingAnchor),
            overlay.bottomAnchor.constraint(equalTo: window.bottomAnchor),
            label.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: overlay.centerYAnchor),
            label.leadingAnchor.constraint(greaterThanOrEqualTo: overlay.leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(lessThanOrEqualTo: overlay.trailingAnchor, constant: -24),
        ])

        blackOverlay = overlay
    }

    private func removeOverlay() {
        blackOverlay?.removeFromSuperview()
        blackOverlay = nil
    }
}
