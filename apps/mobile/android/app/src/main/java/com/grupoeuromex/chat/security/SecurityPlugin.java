package com.grupoeuromex.chat.security;

import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Plugin Capacitor que controla FLAG_SECURE en el Activity principal.
 *
 * Se invoca desde el JS via:
 *   window.Capacitor.Plugins.Security.setFlagSecure({ value: true|false })
 *
 * Cuando value=true, Android bloquea a nivel OS:
 *   - Screenshots manuales (preview en negro)
 *   - Screen recording (la grabación captura solo negro)
 *   - Thumbnail del switcher de Recents (preview en negro)
 *   - Mirroring inalámbrico (Cast / Miracast)
 *
 * IMPORTANTE: las operaciones sobre WindowManager DEBEN correr en el UI
 * thread; por eso usamos getActivity().runOnUiThread(...).
 */
@CapacitorPlugin(name = "Security")
public class SecurityPlugin extends Plugin {

    @PluginMethod
    public void setFlagSecure(PluginCall call) {
        final boolean value = Boolean.TRUE.equals(call.getBoolean("value", false));

        if (getActivity() == null) {
            call.reject("activity_unavailable");
            return;
        }

        getActivity().runOnUiThread(() -> {
            if (value) {
                getActivity().getWindow().setFlags(
                    WindowManager.LayoutParams.FLAG_SECURE,
                    WindowManager.LayoutParams.FLAG_SECURE
                );
            } else {
                getActivity().getWindow().clearFlags(
                    WindowManager.LayoutParams.FLAG_SECURE
                );
            }

            JSObject ret = new JSObject();
            ret.put("value", value);
            call.resolve(ret);
        });
    }
}
