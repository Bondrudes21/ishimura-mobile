package com.bondrudes21.ishimura;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Собственный плагин приложения: файлы, браузер, распаковка, аудиоплеер
        registerPlugin(ArkPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
