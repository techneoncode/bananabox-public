package eu.bananabox.clion;

import com.google.gson.*;
import com.intellij.ide.BrowserUtil;
import com.intellij.ide.ui.LafManagerListener;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.editor.colors.EditorColorsManager;
import com.intellij.openapi.util.Disposer;
import com.intellij.ui.content.Content;
import com.intellij.ui.jcef.*;
import com.intellij.util.ui.UIUtil;
import org.cef.browser.CefBrowser;
import org.cef.browser.CefFrame;
import org.cef.handler.*;
import org.cef.network.CefRequest;
import javax.swing.*;
import java.awt.*;
import java.util.*;
import java.util.regex.Pattern;
import static eu.bananabox.clion.Host.*;

final class WebviewPanel implements Disposable {
    private final Host host;
    private final String id;
    private final JBCefBrowser browser;
    private final JBCefJSQuery query;
    private final JPanel panel = new JPanel(new BorderLayout());
    private final java.util.List<JsonElement> queued = new ArrayList<>();
    private String pageUrl = "";
    private boolean loaded;
    private boolean disposed;
    Content content;
    WebviewEditorProvider.Page editorFile;

    WebviewPanel(Host host, String id) {
        this.host = host; this.id = id;
        if (!JBCefApp.isSupported()) {
            browser = null; query = null;
            panel.add(new JLabel("Bananabox needs the bundled JetBrains Runtime with JCEF. Restart CLion using its bundled runtime.")); return;
        }
        browser = new JBCefBrowser(); query = JBCefJSQuery.create((JBCefBrowserBase)browser);
        Disposer.register(this, browser); Disposer.register(this, query);
        query.addHandler(value -> {
            if (!browser.getCefBrowser().getURL().equals(pageUrl)) return new JBCefJSQuery.Response(null, 403, "Untrusted page");
            try {
                JsonElement message = JsonParser.parseString(value);
                if (!message.isJsonObject()) return null;
                host.notify("webview", obj("id", id, "message", message));
            } catch (RuntimeException ignored) {}
            return null;
        });
        browser.getJBCefClient().addLoadHandler(new CefLoadHandlerAdapter() {
            @Override public void onLoadEnd(CefBrowser cef, CefFrame frame, int status) {
                if (!frame.isMain() || !cef.getURL().equals(pageUrl)) return;
                ui(() -> { loaded = true; theme(); for (var message : new ArrayList<>(queued)) message(message); queued.clear(); });
            }
            @Override public void onLoadError(CefBrowser cef, CefFrame frame, org.cef.handler.CefLoadHandler.ErrorCode code, String text, String url) {
                if (frame.isMain() && url.equals(pageUrl) && code != org.cef.handler.CefLoadHandler.ErrorCode.ERR_ABORTED) host.report("Bananabox could not load its interface: " + text);
            }
        }, browser.getCefBrowser());
        browser.getJBCefClient().addDisplayHandler(new CefDisplayHandlerAdapter() {
            @Override public boolean onConsoleMessage(CefBrowser cef, org.cef.CefSettings.LogSeverity severity, String message, String source, int line) {
                if (severity == org.cef.CefSettings.LogSeverity.LOGSEVERITY_ERROR) ui(() -> host.interfaceError(message + " (line " + line + ")"));
                return false;
            }
        }, browser.getCefBrowser());
        browser.getJBCefClient().addRequestHandler(new CefRequestHandlerAdapter() {
            @Override public boolean onBeforeBrowse(CefBrowser cef, CefFrame frame, CefRequest request, boolean gesture, boolean redirect) {
                if (!frame.isMain()) return true;
                String url = request.getURL();
                if (url.equals(pageUrl) || url.equals("about:blank")) return false;
                if (gesture && (url.startsWith("https://") || url.startsWith("http://"))) BrowserUtil.browse(url);
                return true;
            }
        }, browser.getCefBrowser());
        browser.getJBCefClient().addLifeSpanHandler(new CefLifeSpanHandlerAdapter() {
            @Override public boolean onBeforePopup(CefBrowser cef, CefFrame frame, String url, String target) {
                if (url.startsWith("https://") || url.startsWith("http://")) BrowserUtil.browse(url); return true;
            }
        }, browser.getCefBrowser());
        panel.add(browser.getComponent());
        ApplicationManager.getApplication().getMessageBus().connect(this).subscribe(LafManagerListener.TOPIC, source -> theme());
    }
    JComponent component() { return panel; }
    void load(String html, String base) {
        if (browser == null) return;
        loaded = false; queued.clear(); pageUrl = base + "view/" + id;
        var matcher = Pattern.compile("nonce=\"([^\"]+)\"").matcher(html);
        if (!matcher.find()) { host.report("Bananabox view is missing its content-security nonce."); return; }
        String nonce = matcher.group(1);
        String bootstrap = "<script nonce=\"" + nonce + "\">window.acquireVsCodeApi=(()=>{let state;let used=false;return ()=>{if(used)throw Error('API already acquired');used=true;return {postMessage:message=>{" + query.inject("JSON.stringify(message)") + ";},getState:()=>state,setState:value=>(state=value)}}})();</script>";
        html = html.replace("</head>", "<style id=\"bananabox-theme\">" + themeCss() + "</style>" + bootstrap + "</head>");
        // Use a real same-origin response for HTML, scripts, fonts and PDF workers.
        // JCEF's synthetic loadHTML resource handler differs across platform versions.
        host.request("webview.content", obj("id", id, "html", html)).whenComplete((url, error) -> ui(() -> {
            if (disposed) return;
            if (error != null) { host.report("Bananabox could not prepare its interface: " + error.getMessage()); return; }
            browser.loadURL(url.getAsString());
        }));
    }
    void message(JsonElement message) {
        if (browser == null) return;
        if (!loaded) { if (queued.size() < 500) queued.add(message); return; }
        execute("window.dispatchEvent(new MessageEvent('message',{data:" + GSON.toJson(message) + "}));");
    }
    private void execute(String script) { browser.getCefBrowser().executeJavaScript(script, pageUrl, 0); }
    private void theme() {
        if (browser == null || !loaded) return;
        execute("document.getElementById('bananabox-theme').textContent=" + GSON.toJson(themeCss()) + ";document.body.className=" + GSON.toJson(UIUtil.isUnderDarcula() ? "vscode-dark" : "vscode-light") + ";");
    }
    private static String color(Color value) { return String.format("#%02x%02x%02x", value.getRed(), value.getGreen(), value.getBlue()); }
    private static String themeCss() {
        boolean dark = UIUtil.isUnderDarcula();
        var scheme = EditorColorsManager.getInstance().getGlobalScheme();
        String background = color(UIUtil.getPanelBackground()), foreground = color(UIUtil.getLabelForeground());
        String muted = dark ? "#a6a6a6" : "#616161", border = dark ? "#44474e" : "#d3d5d8", input = dark ? "#2b2d30" : "#ffffff", accent = dark ? "#548af7" : "#3574f0";
        Map<String, String> vars = new LinkedHashMap<>();
        for (String key : new String[]{"foreground", "editor-foreground", "sideBar-foreground", "input-foreground", "dropdown-foreground", "button-secondaryForeground", "list-activeSelectionForeground", "editorWidget-foreground", "badge-foreground"}) vars.put(key, foreground);
        for (String key : new String[]{"editor-background", "sideBar-background", "editorWidget-background"}) vars.put(key, background);
        for (String key : new String[]{"descriptionForeground", "disabledForeground", "input-placeholderForeground"}) vars.put(key, muted);
        for (String key : new String[]{"widget-border", "panel-border", "input-border", "dropdown-border", "contrastBorder"}) vars.put(key, border);
        for (String key : new String[]{"input-background", "dropdown-background", "textCodeBlock-background"}) vars.put(key, input);
        for (String key : new String[]{"focusBorder", "textLink-foreground", "textLink-activeForeground", "progressBar-background", "button-background"}) vars.put(key, accent);
        vars.put("button-foreground", "#ffffff"); vars.put("button-hoverBackground", dark ? "#6598ff" : "#2865d9");
        for (String key : new String[]{"button-secondaryBackground", "badge-background", "list-hoverBackground", "toolbar-hoverBackground", "list-inactiveSelectionBackground"}) vars.put(key, dark ? "#393b40" : "#e4e6e9");
        vars.put("button-secondaryHoverBackground", dark ? "#494b50" : "#d4d6d9"); vars.put("list-activeSelectionBackground", dark ? "#2d466b" : "#cce0ff");
        vars.put("errorForeground", dark ? "#f28b82" : "#b3261e"); vars.put("testing-iconPassed", dark ? "#89d185" : "#2a7831");
        vars.put("editorWarning-foreground", dark ? "#e5c07b" : "#805700"); vars.put("editorError-foreground", vars.get("errorForeground"));
        vars.put("editor-font-family", "monospace"); vars.put("font-family", "system-ui, sans-serif"); vars.put("font-size", UIUtil.getLabelFont().getSize() + "px");
        vars.put("editor-font-size", scheme.getEditorFontSize() + "px");
        String[] buckets = {"fatal", "major", "minor", "info"}; String[] colors = dark ? new String[]{"#f28b82", "#e5c07b", "#80c7d9", "#b5a2e0"} : new String[]{"#b3261e", "#805700", "#006779", "#6941a5"};
        for (int i = 0; i < buckets.length; i++) { vars.put("bananalens-inline-" + buckets[i] + "Foreground", colors[i]); vars.put("bananalens-inline-" + buckets[i] + "Background", colors[i] + "18"); vars.put("bananalens-inline-" + buckets[i] + "Underline", colors[i] + "70"); }
        StringBuilder css = new StringBuilder(":root{color-scheme:" + (dark ? "dark" : "light") + ";");
        vars.forEach((key, value) -> css.append("--vscode-").append(key).append(':').append(value).append(';'));
        return css.append("}body{margin:0;color:var(--vscode-foreground);background:var(--vscode-editor-background);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size)}").toString();
    }
    @Override public void dispose() { disposed = true; queued.clear(); host.notify("webview.removeContent", obj("id", id)); }
}
