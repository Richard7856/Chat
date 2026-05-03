package com.euromex.chat;

import android.os.Bundle;

import com.euromex.chat.security.SecurityPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Los plugins custom deben registrarse ANTES de super.onCreate
        // para que estén disponibles en el bridge cuando carga el WebView.
        registerPlugin(SecurityPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
