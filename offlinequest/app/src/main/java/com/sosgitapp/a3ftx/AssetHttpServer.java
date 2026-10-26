package com.sosgitapp.a3ftx;

import android.content.Context;
import android.content.res.AssetManager;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

/**
 * Serves the packaged briefing at http://127.0.0.1 only.
 * That address is a secure context, which WebXR requires.
 */
final class AssetHttpServer {
    private static final int PREFERRED_PORT = 8734;

    private final AssetManager assets;
    private final ServerSocket socket;
    private volatile boolean running = true;

    AssetHttpServer(Context context) throws IOException {
        this.assets = context.getApplicationContext().getAssets();
        this.socket = new ServerSocket();
        this.socket.setReuseAddress(true);
        try {
            this.socket.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), PREFERRED_PORT));
        } catch (IOException busy) {
            this.socket.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0));
        }
    }

    int getPort() {
        return socket.getLocalPort();
    }

    void start() {
        Thread thread = new Thread(this::acceptLoop, "briefing-http");
        thread.setDaemon(true);
        thread.start();
    }

    void stop() {
        running = false;
        try {
            socket.close();
        } catch (IOException ignored) {
            // Closing the socket unblocks accept.
        }
    }

    private void acceptLoop() {
        while (running) {
            try {
                Socket client = socket.accept();
                Thread worker = new Thread(() -> handle(client), "briefing-http-client");
                worker.setDaemon(true);
                worker.start();
            } catch (IOException closed) {
                return;
            }
        }
    }

    private void handle(Socket client) {
        try (Socket connection = client) {
            connection.setSoTimeout(8000);
            String request = readHeaders(connection.getInputStream());
            if (request.isEmpty()) return;
            String line = request.split("\r\n", 2)[0];
            String[] parts = line.split(" ");
            if (parts.length < 2) {
                write(connection, 400, "text/plain; charset=utf-8", "Bad request".getBytes(StandardCharsets.UTF_8), -1);
                return;
            }
            String method = parts[0];
            if (!"GET".equals(method) && !"HEAD".equals(method)) {
                write(connection, 405, "text/plain; charset=utf-8", "Method not allowed".getBytes(StandardCharsets.UTF_8), -1);
                return;
            }
            String rawPath = parts[1];
            int query = rawPath.indexOf('?');
            if (query >= 0) rawPath = rawPath.substring(0, query);
            String path;
            try {
                path = URLDecoder.decode(rawPath, "UTF-8");
            } catch (IllegalArgumentException bad) {
                write(connection, 400, "text/plain; charset=utf-8", "Bad request".getBytes(StandardCharsets.UTF_8), -1);
                return;
            }
            if ("/".equals(path)) path = "/index.html";
            if (!path.startsWith("/") || path.contains("..") || path.contains("\\")) {
                write(connection, 400, "text/plain; charset=utf-8", "Bad request".getBytes(StandardCharsets.UTF_8), -1);
                return;
            }
            byte[] body;
            try (InputStream asset = assets.open("www" + path)) {
                body = readAll(asset);
            } catch (IOException missing) {
                write(connection, 404, "text/plain; charset=utf-8", "Not found".getBytes(StandardCharsets.UTF_8), -1);
                return;
            }
            write(connection, 200, mime(path), "HEAD".equals(method) ? new byte[0] : body, body.length);
        } catch (IOException ignored) {
            // The browser closed the connection.
        }
    }

    private static String readHeaders(InputStream in) throws IOException {
        ByteArrayOutputStream header = new ByteArrayOutputStream();
        int value;
        while ((value = in.read()) != -1) {
            header.write(value);
            int size = header.size();
            if (size > 8192) return "";
            if (size >= 4) {
                byte[] bytes = header.toByteArray();
                if (bytes[size - 4] == '\r' && bytes[size - 3] == '\n'
                        && bytes[size - 2] == '\r' && bytes[size - 1] == '\n') {
                    return header.toString("ISO-8859-1");
                }
            }
        }
        return header.toString("ISO-8859-1");
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = in.read(buffer)) != -1) {
            out.write(buffer, 0, count);
        }
        return out.toByteArray();
    }

    private static void write(Socket connection, int status, String type, byte[] body, int length) throws IOException {
        int contentLength = length >= 0 ? length : body.length;
        String reason = status == 200 ? "OK" : status == 404 ? "Not Found" : status == 405 ? "Method Not Allowed" : "Bad Request";
        String cache = type.startsWith("text/html") ? "no-cache" : "public, max-age=31536000";
        String header = "HTTP/1.1 " + status + " " + reason + "\r\n"
                + "Content-Type: " + type + "\r\n"
                + "Content-Length: " + contentLength + "\r\n"
                + "Cache-Control: " + cache + "\r\n"
                + "Connection: close\r\n\r\n";
        OutputStream out = connection.getOutputStream();
        out.write(header.getBytes(StandardCharsets.ISO_8859_1));
        if (body.length > 0) out.write(body);
        out.flush();
    }

    private static String mime(String path) {
        String lower = path.toLowerCase();
        if (lower.endsWith(".html")) return "text/html; charset=utf-8";
        if (lower.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (lower.endsWith(".css")) return "text/css; charset=utf-8";
        if (lower.endsWith(".json") || lower.endsWith(".webmanifest")) return "application/json";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".glb")) return "model/gltf-binary";
        if (lower.endsWith(".wasm")) return "application/wasm";
        if (lower.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }
}
