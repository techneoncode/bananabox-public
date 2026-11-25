package eu.bananabox.clion;

import com.google.gson.*;
import com.intellij.analysis.problemsView.ProblemsCollector;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.fileEditor.*;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.startup.StartupActivity;
import com.intellij.openapi.vfs.LocalFileSystem;
import com.intellij.openapi.wm.ToolWindowManager;
import com.intellij.ui.jcef.*;
import org.jetbrains.annotations.NotNull;
import javax.swing.Timer;
import java.nio.file.*;
import java.lang.reflect.Field;
import java.util.Map;

/** Injected only by smoke.py into its disposable plugin copy. Never shipped. */
public final class SmokeActivity implements StartupActivity.DumbAware {
    private JBCefJSQuery probe;
    private boolean checkedEdit;
    private volatile boolean uiReady;
    private volatile boolean githubReady;
    @Override public void runActivity(@NotNull Project project) {
        Host.ui(() -> {
            try {
                var tool = ToolWindowManager.getInstance(project).getToolWindow("Bananabox");
                if (tool == null) throw new IllegalStateException("Tool window was not registered");
                Host host = project.getService(Host.class); tool.activate(null);
                var github = ApplicationManager.getApplication().getService(GithubSessions.class);
                if (github == null) throw new IllegalStateException("Native GitHub integration was not registered");
                if (com.intellij.openapi.actionSystem.ActionManager.getInstance().getAction("Bananabox.GithubLogin") == null)
                    throw new IllegalStateException("GitHub sign-in action was not registered");
                com.intellij.util.concurrency.AppExecutorUtil.getAppExecutorService().execute(() -> {
                    try {
                        if (github.session(project, false) != null) throw new IllegalStateException("Unexpected GitHub account in isolated profile");
                        githubReady = true;
                        trace("GitHub", "Native account integration loaded; silent request returned without prompting");
                    } catch (Throwable error) { finish("failed", error.toString()); }
                });
                com.intellij.ide.GeneralSettings.getInstance().setAutoSaveIfInactive(false);
                com.intellij.ide.GeneralSettings.getInstance().setSaveOnFrameDeactivation(false);
                var file = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(Path.of(project.getBasePath(), "main.c"));
                new OpenFileDescriptor(project, file).navigate(true);
                host.command("bananabox.codingStyle.run");
                Timer timer = new Timer(1000, null);
                timer.addActionListener(event -> Host.ui(() -> {
                    try {
                        if (project.isDisposed()) { timer.stop(); return; }
                        Field viewsField = Host.class.getDeclaredField("views"); viewsField.setAccessible(true);
                        Object view = ((Map<?, ?>)viewsField.get(host)).get("sidebar");
                        if (view == null) {
                            Field startup = Host.class.getDeclaredField("startupText"); startup.setAccessible(true);
                            var placeholder = (javax.swing.JTextArea)startup.get(host);
                            trace("startup", placeholder == null ? "Tool window not attached" : placeholder.getText());
                        }
                        if (view != null) {
                            Field browserField = WebviewPanel.class.getDeclaredField("browser"); browserField.setAccessible(true);
                            JBCefBrowser browser = (JBCefBrowser)browserField.get(view);
                            if (browser == null) throw new IllegalStateException("JCEF unavailable");
                            if (probe == null) {
                                probe = JBCefJSQuery.create((JBCefBrowserBase)browser);
                                probe.addHandler(value -> {
                                    JsonObject dom = JsonParser.parseString(value).getAsJsonObject();
                                    uiReady = !dom.get("text").getAsString().isBlank() && dom.get("buttons").getAsInt() > 0;
                                    trace("DOM", dom.toString()); return null;
                                });
                            }
                            String data = "JSON.stringify({text:document.getElementById('app')?.innerText||'',buttons:document.querySelectorAll('button').length,api:typeof acquireVsCodeApi,url:location.href})";
                            browser.getCefBrowser().executeJavaScript(probe.inject(data), browser.getCefBrowser().getURL(), 0);
                        }
                        var document = FileDocumentManager.getInstance().getDocument(file);
                        if (document == null) return;
                        var open = com.intellij.openapi.editor.EditorFactory.getInstance().getEditors(document, project);
                        if (open.length == 0) return;
                        var editor = open[0];
                        trace("editor", "UI ready=" + uiReady + ", problems=" + ProblemsCollector.getInstance(project).getFileProblemCount(file) + ", corrected=" + !document.getText().contains("return 0;  "));
                        if (ProblemsCollector.getInstance(project).getFileProblems(file).stream().noneMatch(problem -> "Bananabox Coding Style".equals(problem.getGroup()))) return;
                        if (ProblemsCollector.getInstance(project).getFileProblems(file).stream().anyMatch(problem -> problem.getText().contains("nested while"))) throw new IllegalStateException("Unexpected nested-while diagnostic for a simple return");
                        if (!checkedEdit) {
                            checkedEdit = true;
                            new OpenFileDescriptor(project, file).navigate(true);
                            host.editor.syncEditors();
                            host.request("command", Host.obj("id", "bananabox.codingStyle.fixTrailingWhitespace")).whenComplete((result, error) -> {
                                if (error != null) finish("failed", error.toString());
                            });
                            return;
                        }
                        if (editor.getDocument().getText().contains("return 0;  ")) return;
                        if (uiReady && githubReady) { timer.stop(); finish("passed", "Native tool window, rendered interface, JCEF bridge, Problems, real epiclang, correction and native GitHub integration verified."); }
                    } catch (Throwable error) { timer.stop(); finish("failed", error.toString()); }
                }));
                timer.start();
            } catch (Throwable error) { finish("failed", error.toString()); }
        });
    }
    private static void finish(String status, String detail) {
        try { Files.writeString(Path.of(System.getProperty("bananabox.smoke.report")), Host.obj("status", status, "detail", detail).toString()); }
        catch (Exception error) { error.printStackTrace(); }
    }
    private static void trace(String stage, String detail) {
        try { Files.writeString(Path.of(System.getProperty("bananabox.smoke.report") + ".trace"), stage + ": " + detail + "\n", StandardOpenOption.CREATE, StandardOpenOption.APPEND); }
        catch (Exception ignored) {}
    }
}
