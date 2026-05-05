#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Registra el plugin con Capacitor en runtime para que el WebView lo
// exponga como window.Capacitor.Plugins.Security.
//
// En Android es @CapacitorPlugin annotation; en iOS Capacitor 6 todavía
// requiere este macro Objective-C porque el plugin se carga vía
// Objective-C runtime selectors (Swift por sí solo no es suficiente).
CAP_PLUGIN(SecurityPlugin, "Security",
    CAP_PLUGIN_METHOD(setFlagSecure, CAPPluginReturnPromise);
)
