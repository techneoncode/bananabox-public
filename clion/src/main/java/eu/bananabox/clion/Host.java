package eu.bananabox.clion;

import com.google.gson.*;
import com.intellij.credentialStore.*;
import com.intellij.ide.BrowserUtil;
import com.intellij.ide.impl.TrustedProjects;
import com.intellij.ide.passwordSafe.PasswordSafe;
import com.intellij.ide.plugins.PluginManagerCore;
import com.intellij.notification.*;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.*;
import com.intellij.openapi.extensions.PluginId;
import com.intellij.openapi.options.ShowSettingsUtil;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.wm.*;
import com.intellij.ui.content.*;
import com.intellij.util.concurrency.AppExecutorUtil;
import org.jetbrains.annotations.NotNull;
import javax.swing.*;
import java.awt.BorderLayout;
import java.awt.datatransfer.StringSelection;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

public final class Host implements Disposable {
    static final Gson GSON = new GsonBuilder().serializeNulls().create();
    final Project project;
    final EditorBridge editor;
    private final Map<String, WebviewPanel> views = new HashMap<>();
    private final Map<String, JsonObject> pendingHtml = new HashMap<>();
    private final Map<Long, CompletableFuture<JsonElement>> requests = new ConcurrentHashMap<>();
    private final AtomicLong sequence = new AtomicLong();
    private final Map<String, StringBuilder> logs = new HashMap<>();
    private final Map<String, JTextArea> outputAreas = new HashMap<>();
    private final Map<String, JsonObject> statuses = new LinkedHashMap<>();
    private final Map<String, com.intellij.openapi.progress.ProgressIndicator> progress = new ConcurrentHashMap<>();
    private final Set<String> finishedProgress = ConcurrentHashMap.newKeySet();
    private final ExecutorService writer = AppExecutorUtil.createBoundedApplicationPoolExecutor("Bananabox IPC writer", 1);
    private volatile Process process;
    private volatile BufferedWriter stdin;
    private CompletableFuture<JsonElement> ready;
    private ToolWindow window;
    private Content sidebarContent;
    private JTextArea startupText;
    private boolean disposed;
    private boolean startedListeners;
    private CommitTree commitTree;

    public Host(Project project) { this.project = project; this.editor = new EditorBridge(this); }
    static JsonObject obj(Object... pairs) {
        JsonObject value = new JsonObject();
        for (int i = 0; i < pairs.length; i += 2) value.add((String)pairs[i], GSON.toJsonTree(pairs[i + 1]));
        return value;
    }
    static String str(JsonObject value, String key) { return value.has(key) && !value.get(key).isJsonNull() ? value.get(key).getAsString() : ""; }
    static boolean bool(JsonObject value, String key) { return value.has(key) && !value.get(key).isJsonNull() && value.get(key).getAsBoolean(); }
    static JsonObject object(JsonObject value, String key) { return value.has(key) && value.get(key).isJsonObject() ? value.getAsJsonObject(key) : new JsonObject(); }
    static JsonArray array(JsonObject value, String key) { return value.has(key) && value.get(key).isJsonArray() ? value.getAsJsonArray(key) : new JsonArray(); }
    static void ui(Runnable action) { ApplicationManager.getApplication().invokeLater(action, ModalityState.nonModal()); }

    public void attach(ToolWindow toolWindow) {
        window = toolWindow;
        if (sidebarContent == null) {
            startupText = new JTextArea("Starting Bananabox…"); startupText.setEditable(false); startupText.setLineWrap(true);
            JPanel panel = new JPanel(new BorderLayout()); panel.add(new JScrollPane(startupText));
            JButton settings = new JButton("Bananabox settings"); settings.addActionListener(e -> ShowSettingsUtil.getInstance().showSettingsDialog(project, SettingsPage.class));
            JButton retry = new JButton("Restart engine"); retry.addActionListener(e -> restart());
            JButton projectSettings = new JButton("Project settings"); projectSettings.addActionListener(e -> editProjectSettings());
            JPanel buttons = new JPanel(); buttons.add(settings); buttons.add(projectSettings); buttons.add(retry); panel.add(buttons, BorderLayout.SOUTH);
            sidebarContent = ContentFactory.getInstance().createContent(panel, "Projects", false);
            window.getContentManager().addContent(sidebarContent);
        }
        for (var entry : new HashMap<>(pendingHtml).entrySet()) showHtml(entry.getValue());
        start();
    }

    public synchronized void start() {
        if (disposed || ready != null) return;
        ready = new CompletableFuture<>();
        CompletableFuture<JsonElement> startup = ready;
        AppExecutorUtil.getAppExecutorService().execute(() -> {
            try {
                var plugin = PluginManagerCore.getPlugin(PluginId.getId("eu.bananabox.clion"));
                if (plugin == null) throw new IOException("Bananabox plugin directory is unavailable.");
                Path root = plugin.getPluginPath().resolve("host");
                Path storage = Path.of(PathManager.getSystemPath(), "bananabox"); Files.createDirectories(storage);
                if (project.getBasePath() == null) throw new IOException("Open a project folder first.");
                ProcessBuilder builder = new ProcessBuilder(Settings.get().getState().nodeExecutable, root.resolve("main.cjs").toString());
                builder.directory(Path.of(project.getBasePath()).toFile());
                // Do not let ambient Node injection variables change the bundled engine.
                builder.environment().remove("NODE_OPTIONS"); builder.environment().remove("NODE_PATH");
                Process child = builder.start();
                synchronized (this) {
                    if (disposed || ready != startup) { child.destroy(); return; }
                    process = child; stdin = new BufferedWriter(new OutputStreamWriter(child.getOutputStream(), StandardCharsets.UTF_8));
                }
                AppExecutorUtil.getAppExecutorService().execute(() -> read(child));
                AppExecutorUtil.getAppExecutorService().execute(() -> {
                    try (var reader = child.errorReader(StandardCharsets.UTF_8)) {
                        String line; while ((line = reader.readLine()) != null) { String text = line; ui(() -> appendOutput("Engine", text)); }
                    } catch (IOException ignored) {}
                });
                var global = Settings.get().getState(); var local = project.getService(ProjectSettings.class).getState();
                JsonObject init = obj("root", project.getBasePath(), "extensionRoot", root.toString(), "storage", storage.toString(),
                    "trusted", TrustedProjects.isTrusted(project), "language", Locale.getDefault().getLanguage(),
                    "manifest", JsonParser.parseString(Files.readString(root.resolve("package.json"))),
                    "globalSettings", JsonParser.parseString(global.settings), "projectSettings", JsonParser.parseString(local.settings),
                    "globalState", JsonParser.parseString(global.memento), "projectState", JsonParser.parseString(local.memento));
                request("initialize", init).whenComplete((result, error) -> {
                    if (error != null) { startup.completeExceptionally(error); report("Bananabox could not start: " + error.getMessage()); return; }
                    startup.complete(result);
                    ui(() -> { if (disposed || ready != startup) return; if (!startedListeners) { editor.listen(); startedListeners = true; } editor.syncEditors(); });
                });
            } catch (Exception error) {
                startup.completeExceptionally(error);
                report("Bananabox could not start. Install Node.js 20+ or set its executable in Settings → Bananabox.\n" + error.getMessage());
            }
        });
    }

    private void read(Process child) {
        try (var reader = child.inputReader(StandardCharsets.UTF_8)) {
            String line;
            while ((line = reader.readLine()) != null) {
                JsonObject message = JsonParser.parseString(line).getAsJsonObject();
                if (!message.has("method")) {
                    var future = requests.remove(message.get("id").getAsLong());
                    if (future != null) {
                        if (message.has("error")) future.completeExceptionally(new IOException(str(message, "error")));
                        else future.complete(message.get("result"));
                    }
                } else dispatch(message);
            }
        } catch (Exception error) { if (!disposed && process == child) report("Bananabox engine connection failed: " + error.getMessage()); }
        finally {
            if (process == child && !disposed) {
                requests.values().forEach(future -> future.completeExceptionally(new IOException("Bananabox engine stopped"))); requests.clear();
                ui(() -> { editor.clear(); report("Bananabox engine stopped. Use Tools → Bananabox → Restart Bananabox Engine."); });
            }
        }
    }

    private void write(JsonObject message) {
        BufferedWriter stream = stdin;
        if (stream == null || disposed) return;
        writer.execute(() -> { try { stream.write(message.toString()); stream.newLine(); stream.flush(); } catch (IOException error) { if (!disposed && stream == stdin) report("Bananabox engine disconnected."); } });
    }
    void notify(String method, JsonObject params) { write(obj("method", method, "params", params)); }
    CompletableFuture<JsonElement> request(String method, JsonObject params) {
        long id = sequence.incrementAndGet(); var future = new CompletableFuture<JsonElement>(); requests.put(id, future);
        write(obj("id", id, "method", method, "params", params));
        future.orTimeout(10, TimeUnit.MINUTES).whenComplete((v, e) -> requests.remove(id)); return future;
    }
    public void command(String id) {
        start();
        ready.thenRun(() -> { notify("trust", obj("trusted", TrustedProjects.isTrusted(project))); notify("command", obj("id", id)); });
    }
    void command(JsonObject command) { notify("command", obj("id", str(command, "command"), "arguments", array(command, "arguments"))); }

    private void dispatch(JsonObject message) {
        String method = str(message, "method"); JsonObject params = object(message, "params");
        Runnable work = () -> {
            try {
                Object result = operation(method, params);
                if (message.has("id")) write(obj("id", message.get("id"), "result", result));
            } catch (Exception error) {
                if (message.has("id")) write(obj("id", message.get("id"), "error", error.getMessage() == null ? error.toString() : error.getMessage()));
                else report("Bananabox: " + error.getMessage());
            }
        };
        if (method.startsWith("secret.") || method.equals("github.session")) AppExecutorUtil.getAppExecutorService().execute(work);
        else ui(() -> { if (!disposed && !project.isDisposed()) work.run(); });
    }

    private Object operation(String method, JsonObject p) throws Exception {
        switch (method) {
            case "secret.get": return PasswordSafe.getInstance().getPassword(new CredentialAttributes("Bananabox/" + str(p, "key")));
            case "secret.set": PasswordSafe.getInstance().setPassword(new CredentialAttributes("Bananabox/" + str(p, "key")), p.get("value").isJsonNull() ? null : str(p, "value")); return null;
            case "github.session": return githubSession(bool(p, "interactive"));
            case "state.update": updateStored(p, false); return null;
            case "settings.update": updateStored(p, true); return null;
            case "settings.open": ShowSettingsUtil.getInstance().showSettingsDialog(project, SettingsPage.class); return null;
            case "context": editor.context(str(p, "key"), p.get("value")); return null;
            case "webview.create": pendingHtml.put(str(p, "id"), p); return null;
            case "webview.html": showHtml(p); return null;
            case "webview.message": { var view = views.get(str(p, "id")); if (view != null) view.message(p.get("message")); return null; }
            case "webview.reveal": reveal(str(p, "id")); return null;
            case "webview.close": closeView(str(p, "id")); return null;
            case "dialog.message": return Dialogs.message(project, p);
            case "dialog.input": return Dialogs.input(project, p);
            case "dialog.pick": return Dialogs.pick(project, p);
            case "dialog.open": return Dialogs.open(project, p);
            case "dialog.save": return Dialogs.save(project, p);
            case "external.open": {
                String uri = str(p, "uri"); String scheme = java.net.URI.create(uri).getScheme();
                if (!Set.of("http", "https", "file").contains(scheme)) throw new IOException("Unsupported external link.");
                BrowserUtil.browse(uri); return true;
            }
            case "clipboard": com.intellij.openapi.ide.CopyPasteManager.getInstance().setContents(new StringSelection(str(p, "text"))); return null;
            case "project.open": {
                Path target = Path.of(java.net.URI.create(str(p, "uri")));
                AppExecutorUtil.getAppExecutorService().execute(() -> com.intellij.ide.impl.ProjectUtil.openOrImport(target, project, bool(p, "newWindow"))); return true;
            }
            case "output.append": appendOutput(str(p, "name"), str(p, "text")); return null;
            case "output.show": showOutput(str(p, "name")); return null;
            case "output.clear": logs.remove(str(p, "name")); if (outputAreas.containsKey(str(p, "name"))) outputAreas.get(str(p, "name")).setText(""); return null;
            case "status": updateStatus(p); return null;
            case "progress.start": startProgress(p); return null;
            case "progress.update": { var indicator = progress.get(str(p, "id")); if (indicator != null) indicator.setText2(str(p, "message")); return null; }
            case "progress.end": { String id = str(p, "id"); finishedProgress.add(id); var indicator = progress.get(id); if (indicator != null) indicator.stop(); return null; }
            case "tree.refresh": if (commitTree != null) commitTree.reload(); return null;
            case "tree.focus": showTree(); return null;
            // CLion has no VS Code window reload: restarting the engine re-reads the settings and extension state.
            case "ide.restart": restart(); return null;
            default: return editor.operation(method, p);
        }
    }

    private synchronized void updateStored(JsonObject p, boolean settings) {
        var global = Settings.get().getState(); var local = project.getService(ProjectSettings.class).getState();
        boolean app = settings ? p.get("target").getAsInt() == 1 : str(p, "scope").equals("global");
        String text = settings ? (app ? global.settings : local.settings) : (app ? global.memento : local.memento);
        JsonObject values = JsonParser.parseString(text).getAsJsonObject(); String key = str(p, "key");
        if (p.get("value").isJsonNull()) values.remove(key); else values.add(key, p.get("value"));
        if (settings) { if (app) global.settings = values.toString(); else local.settings = values.toString(); }
        else { if (app) global.memento = values.toString(); else local.memento = values.toString(); }
    }
    public void settingsChanged() {
        if (ready != null && ready.isDone() && !ready.isCompletedExceptionally()) notify("settings.changed", obj("global", JsonParser.parseString(Settings.get().getState().settings), "project", JsonParser.parseString(project.getService(ProjectSettings.class).getState().settings)));
    }
    private void editProjectSettings() {
        String current = project.getService(ProjectSettings.class).getState().settings;
        JTextArea area = new JTextArea(new GsonBuilder().setPrettyPrinting().create().toJson(JsonParser.parseString(current)), 20, 65);
        if (JOptionPane.showConfirmDialog(window.getComponent(), new JScrollPane(area), "Bananabox · Project settings JSON", JOptionPane.OK_CANCEL_OPTION) != JOptionPane.OK_OPTION) return;
        try { project.getService(ProjectSettings.class).getState().settings = SettingsPage.validate(area.getText()).toString(); settingsChanged(); }
        catch (Exception error) { Messages.showErrorDialog(project, error.getMessage(), "Bananabox"); }
    }
    private Object githubSession(boolean interactive) throws Exception {
        GithubSessions sessions = ApplicationManager.getApplication().getService(GithubSessions.class);
        if (sessions != null) return sessions.session(project, interactive);
        if (interactive) throw new IllegalStateException("Enable the bundled GitHub plugin in Settings → Plugins, then restart CLion to sign in with your browser.");
        return null;
    }
    public void connectGithub() {
        AppExecutorUtil.getAppExecutorService().execute(() -> {
            try {
                JsonObject session = (JsonObject)githubSession(true);
                if (session != null) ui(() -> {
                    if (!project.isDisposed()) NotificationGroupManager.getInstance().getNotificationGroup("Bananabox")
                        .createNotification("GitHub · " + str(object(session, "account"), "label"), NotificationType.INFORMATION).notify(project);
                });
            } catch (Exception error) { report("GitHub: " + error.getMessage()); }
        });
    }

    private void showHtml(JsonObject params) {
        String id = str(params, "id");
        JsonObject previous = pendingHtml.get(id);
        if (previous != null && previous.has("title")) params.add("title", previous.get("title"));
        pendingHtml.put(id, params);
        if ((window == null && id.equals("sidebar")) || !params.has("html")) return;
        WebviewPanel view = views.get(id);
        if (view == null) {
            view = new WebviewPanel(this, id); views.put(id, view);
            if (id.equals("sidebar")) {
                JPanel container = (JPanel)sidebarContent.getComponent();
                java.awt.Component placeholder = ((BorderLayout)container.getLayout()).getLayoutComponent(BorderLayout.CENTER);
                if (placeholder != null) container.remove(placeholder);
                container.add(view.component(), BorderLayout.CENTER);
                container.revalidate(); container.repaint();
            }
            else {
                view.editorFile = new WebviewEditorProvider.Page(this, id, str(params, "title").isBlank() ? "Bananabox" : str(params, "title"), view);
                com.intellij.openapi.fileEditor.FileEditorManager.getInstance(project).openFile(view.editorFile, true);
            }
            Disposer.register(this, view);
        }
        view.load(str(params, "html"), str(params, "base")); if (window != null) window.getComponent().revalidate();
    }
    private void reveal(String id) {
        var view = views.get(id); if (view == null) return;
        if (view.editorFile != null) com.intellij.openapi.fileEditor.FileEditorManager.getInstance(project).openFile(view.editorFile, true);
        else if (window != null) { window.activate(null); window.getContentManager().setSelectedContent(sidebarContent); }
    }
    void editorPageClosed(String id, WebviewPanel panel) {
        if (views.remove(id, panel)) { pendingHtml.remove(id); Disposer.dispose(panel); notify("webview.closed", obj("id", id)); }
    }
    private void closeView(String id) {
        var view = views.remove(id); pendingHtml.remove(id);
        if (view != null) { if (view.editorFile != null) com.intellij.openapi.fileEditor.FileEditorManager.getInstance(project).closeFile(view.editorFile); Disposer.dispose(view); }
    }
    private void appendOutput(String name, String text) {
        var buffer = logs.computeIfAbsent(name, key -> new StringBuilder()); buffer.append(text).append('\n');
        if (buffer.length() > 500_000) buffer.delete(0, buffer.length() - 400_000);
        var area = outputAreas.get(name); if (area != null) area.setText(buffer.toString());
    }
    void interfaceError(String text) { appendOutput("Interface", text); com.intellij.openapi.diagnostic.Logger.getInstance(Host.class).warn("Bananabox interface: " + text); }
    private void showOutput(String name) {
        if (window == null) { var tool = ToolWindowManager.getInstance(project).getToolWindow("Bananabox"); if (tool != null) { tool.activate(() -> showOutput(name)); } return; }
        JTextArea area = outputAreas.get(name);
        if (area == null) { area = new JTextArea(); area.setEditable(false); outputAreas.put(name, area); window.getContentManager().addContent(ContentFactory.getInstance().createContent(new JScrollPane(area), name, false)); }
        area.setText(logs.getOrDefault(name, new StringBuilder()).toString());
        for (Content content : window.getContentManager().getContents()) if (content.getDisplayName().equals(name)) window.getContentManager().setSelectedContent(content);
        window.activate(null);
    }
    private void updateStatus(JsonObject p) {
        statuses.put(str(p, "id"), p);
        editor.updateStatus(statuses.values());
    }
    private void startProgress(JsonObject p) {
        String id = str(p, "id");
        new com.intellij.openapi.progress.Task.Backgroundable(project, str(p, "title"), bool(p, "cancellable")) {
            @Override public void run(@NotNull com.intellij.openapi.progress.ProgressIndicator indicator) {
                progress.put(id, indicator); indicator.setIndeterminate(true);
                try {
                    while (!disposed && !finishedProgress.contains(id)) {
                        if (indicator.isCanceled()) { Host.this.notify("progress.cancel", obj("id", id)); break; }
                        try { Thread.sleep(100); } catch (InterruptedException error) { Thread.currentThread().interrupt(); break; }
                    }
                } finally { progress.remove(id); finishedProgress.remove(id); }
            }
        }.queue();
    }
    private void showTree() {
        if (window == null) { var tool = ToolWindowManager.getInstance(project).getToolWindow("Bananabox"); if (tool != null) tool.activate(this::showTree); return; }
        if (commitTree == null) { commitTree = new CommitTree(this); Content content = ContentFactory.getInstance().createContent(commitTree.component(), "Commits", false); window.getContentManager().addContent(content); commitTree.content = content; }
        commitTree.reload(); window.getContentManager().setSelectedContent(commitTree.content); window.activate(null);
    }
    void report(String text) {
        ui(() -> { if (disposed || project.isDisposed()) return; if (startupText != null) startupText.setText(text); NotificationGroupManager.getInstance().getNotificationGroup("Bananabox").createNotification(text, NotificationType.ERROR).notify(project); });
    }
    public void restart() {
        stop(); editor.clear(); for (String id : new ArrayList<>(views.keySet())) closeView(id);
        pendingHtml.clear(); ready = null; start();
    }
    private void stop() {
        Process child = process; process = null;
        if (child != null) {
            try { if (stdin != null) { stdin.write(obj("method", "shutdown", "params", obj()).toString()); stdin.newLine(); stdin.flush(); } } catch (IOException ignored) {}
            AppExecutorUtil.getAppScheduledExecutorService().schedule(() -> { child.descendants().forEach(ProcessHandle::destroy); child.destroy(); }, 2, TimeUnit.SECONDS);
        }
        stdin = null; requests.values().forEach(future -> future.completeExceptionally(new IOException("Host stopped"))); requests.clear();
    }
    @Override public void dispose() { stop(); disposed = true; writer.shutdown(); editor.dispose(); }
}
