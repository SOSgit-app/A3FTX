package com.sosgitapp.a3ftx;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Starts the briefing that is stored inside this APK. The Quest browser
 * draws it, because that browser is what can enter WebXR. The page is
 * http://127.0.0.1 on this headset, not the public website.
 */
public class LauncherActivity extends Activity {
    private boolean opened;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        showWaiting();
        Intent service = new Intent(this, BriefingServer.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(service);
        } else {
            startService(service);
        }
        new Thread(() -> {
            for (int i = 0; i < 50 && BriefingServer.port < 0 && BriefingServer.error == null; i++) {
                try {
                    Thread.sleep(100);
                } catch (InterruptedException interrupted) {
                    return;
                }
            }
            runOnUiThread(this::openBriefing);
        }, "briefing-wait").start();
    }

    private void showWaiting() {
        TextView status = new TextView(this);
        status.setText("Opening the briefing…");
        status.setTextColor(0xFFE2B15A);
        status.setTextSize(22);
        status.setGravity(Gravity.CENTER);
        setContentView(status);
    }

    private void openBriefing() {
        if (opened) return;
        if (BriefingServer.port < 0) {
            showMessage(BriefingServer.error == null
                    ? "The briefing did not start."
                    : BriefingServer.error);
            return;
        }
        opened = true;
        String url = "http://127.0.0.1:" + BriefingServer.port + "/";
        Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        view.setPackage("com.oculus.browser");
        view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(view);
            showMessage("The briefing is open on this headset. Choose Start game in VR.");
        } catch (ActivityNotFoundException missing) {
            showMessage("This headset did not open its browser. The briefing is stored in the app, but VR needs the Quest browser.");
        }
    }

    private void showMessage(String message) {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setPadding(48, 48, 48, 48);
        TextView status = new TextView(this);
        status.setText(message);
        status.setTextColor(0xFFF2EFE9);
        status.setTextSize(18);
        status.setGravity(Gravity.CENTER);
        Button again = new Button(this);
        again.setText("Open again");
        again.setOnClickListener(v -> {
            opened = false;
            openBriefing();
        });
        layout.addView(status);
        layout.addView(again);
        setContentView(layout);
    }
}
