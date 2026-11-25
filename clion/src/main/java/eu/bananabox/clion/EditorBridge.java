package eu.bananabox.clion;

import com.google.gson.*;
import com.intellij.analysis.problemsView.*;
import com.intellij.diff.DiffManager;
import com.intellij.diff.DiffContentFactory;
import com.intellij.diff.requests.SimpleDiffRequest;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.*;
import com.intellij.openapi.command.WriteCommandAction;
import com.intellij.openapi.editor.*;
import com.intellij.openapi.editor.colors.EditorColorsManager;
import com.intellij.openapi.editor.event.*;
import com.intellij.openapi.editor.markup.*;
import com.intellij.openapi.fileEditor.*;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.vfs.*;
import com.intellij.openapi.vfs.newvfs.BulkFileListener;
import com.intellij.openapi.vfs.newvfs.events.*;
import com.intellij.openapi.wm.*;
import com.intellij.testFramework.LightVirtualFile;
import com.intellij.util.ui.UIUtil;
import org.jetbrains.annotations.NotNull;
import javax.swing.*;
import java.awt.*;
import java.awt.event.MouseEvent;
import java.nio.file.Path;
import java.util.*;
import java.util.List;
import static eu.bananabox.clion.Host.*;

final class EditorBridge implements Disposable {
    private final Host host;
    private final Project project;
    private final Map<String, JsonObject> diagnostics = new java.util.concurrent.ConcurrentHashMap<>();
    private final Map<String, List<FileProblem>> problems = new HashMap<>();
    private final Map<Editor, Map<String, List<Disposable>>> decorations = new HashMap<>();
    private final Map<String, JsonObject> decorationData = new HashMap<>();
    private final Map<String, JsonObject> lenses = new HashMap<>();
    private final ProblemsProvider provider;
    private boolean savingCorrection;
    private boolean hasCorrections;
    private Status status;

    EditorBridge(Host host) { this.host = host; project = host.project; provider = () -> project; }
    void listen() {
        var bus = project.getMessageBus().connect(host);
        bus.subscribe(FileEditorManagerListener.FILE_EDITOR_MANAGER, new FileEditorManagerListener() {
            @Override public void selectionChanged(@NotNull FileEditorManagerEvent event) { syncEditors(); host.notify("focus", obj("focused", true)); }
            @Override public void fileOpened(@NotNull FileEditorManager manager, @NotNull VirtualFile file) { syncEditors(); }
            @Override public void fileClosed(@NotNull FileEditorManager manager, @NotNull VirtualFile file) {
                var document = FileDocumentManager.getInstance().getCachedDocument(file);
                if (document != null) host.notify("document", snapshot(file, document, "close"));
                syncEditors();
            }
        });
        ApplicationManager.getApplication().getMessageBus().connect(host).subscribe(FileDocumentManagerListener.TOPIC, new FileDocumentManagerListener() {
            @Override public void afterDocumentSaved(@NotNull Document document) {
                VirtualFile file = FileDocumentManager.getInstance().getFile(document);
                if (!savingCorrection && belongs(file)) host.notify("document", snapshot(file, document, "save"));
            }
        });
        var multicaster = EditorFactory.getInstance().getEventMulticaster();
        multicaster.addDocumentListener(new DocumentListener() {
            @Override public void documentChanged(@NotNull DocumentEvent event) {
                var file = FileDocumentManager.getInstance().getFile(event.getDocument());
                if (belongs(file)) {
                    JsonObject changed = snapshot(file, event.getDocument(), "change");
                    // FileDocumentManager can mark the buffer dirty after this listener.
                    changed.addProperty("dirty", true);
                    host.notify("document", changed);
                }
            }
        }, host);
        multicaster.addCaretListener(new CaretListener() {
            @Override public void caretPositionChanged(@NotNull CaretEvent event) {
                if (event.getEditor().getProject() == project) {
                    var file = FileDocumentManager.getInstance().getFile(event.getEditor().getDocument());
                    if (file != null) host.notify("selection", obj("uri", uri(file), "selection", selection(event.getEditor())));
                }
            }
        }, host);
        multicaster.addEditorMouseListener(new EditorMouseListener() {
            @Override public void mouseClicked(@NotNull EditorMouseEvent event) {
                if (event.getEditor().getProject() != project || !SwingUtilities.isLeftMouseButton(event.getMouseEvent())) return;
                Inlay<?> inlay = event.getEditor().getInlayModel().getElementAt(event.getMouseEvent().getPoint());
                if (inlay != null && inlay.getRenderer() instanceof Row row) {
                    Label label = row.at(inlay, event.getMouseEvent().getX());
                    if (label != null && label.command != null) { host.command(label.command); event.consume(); }
                }
            }
        }, host);
        multicaster.addEditorMouseMotionListener(new EditorMouseMotionListener() {
            @Override public void mouseMoved(@NotNull EditorMouseEvent event) {
                if (event.getEditor().getProject() != project) return;
                var inlay = event.getEditor().getInlayModel().getElementAt(event.getMouseEvent().getPoint());
                Label label = inlay != null && inlay.getRenderer() instanceof Label direct ? direct : inlay != null && inlay.getRenderer() instanceof Row row ? row.at(inlay, event.getMouseEvent().getX()) : null;
                event.getEditor().getContentComponent().setToolTipText(label == null ? null : label.tooltip);
            }
        }, host);
        ApplicationManager.getApplication().getMessageBus().connect(host).subscribe(VirtualFileManager.VFS_CHANGES, new BulkFileListener() {
            @Override public void after(@NotNull List<? extends VFileEvent> events) {
                JsonArray entries = new JsonArray();
                for (var event : events) {
                    if (project.getBasePath() == null || !event.getPath().startsWith(project.getBasePath() + "/")) continue;
                    entries.add(obj("path", event.getPath(), "kind", event instanceof VFileDeleteEvent ? "delete" : event instanceof VFileCreateEvent ? "create" : "change"));
                    if (event instanceof VFileMoveEvent move) entries.add(obj("path", move.getOldPath(), "kind", "delete"));
                    if (event instanceof VFilePropertyChangeEvent change && VirtualFile.PROP_NAME.equals(change.getPropertyName())) entries.add(obj("path", change.getOldPath(), "kind", "delete"));
                }
                if (!entries.isEmpty()) host.notify("files", obj("entries", entries));
            }
        });
    }
    private boolean belongs(VirtualFile file) {
        return file != null && file.isInLocalFileSystem() && project.getBasePath() != null && (file.getPath().startsWith(project.getBasePath() + "/") || FileEditorManager.getInstance(project).isFileOpen(file));
    }
    static String uri(VirtualFile file) { return Path.of(file.getPath()).toUri().toASCIIString(); }
    private static JsonObject point(LogicalPosition position) { return obj("line", position.line, "character", position.column); }
    private static JsonObject selection(Editor editor) {
        return obj("start", point(editor.offsetToLogicalPosition(editor.getSelectionModel().getSelectionStart())), "end", point(editor.offsetToLogicalPosition(editor.getSelectionModel().getSelectionEnd())));
    }
    private static JsonObject snapshot(VirtualFile file, Document document, String event) {
        return obj("uri", uri(file), "text", document.getText(), "version", document.getModificationStamp(), "dirty", FileDocumentManager.getInstance().isDocumentUnsaved(document), "event", event);
    }
    void syncEditors() {
        JsonArray visible = new JsonArray();
        Set<Editor> active = new HashSet<>();
        var manager = FileEditorManager.getInstance(project);
        for (FileEditor selected : manager.getSelectedEditors()) {
            if (!(selected instanceof TextEditor text)) continue;
            Editor editor = text.getEditor(); VirtualFile file = FileDocumentManager.getInstance().getFile(editor.getDocument());
            if (!belongs(file)) continue;
            active.add(editor); JsonObject data = snapshot(file, editor.getDocument(), "open"); data.add("selection", selection(editor)); visible.add(data);
            renderCached(editor, uri(file));
        }
        for (Editor previous : new ArrayList<>(decorations.keySet())) if (!active.contains(previous)) clearEditor(previous);
        Editor selected = manager.getSelectedTextEditor(); VirtualFile file = selected == null ? null : FileDocumentManager.getInstance().getFile(selected.getDocument());
        host.notify("editors", obj("documents", visible, "active", file == null ? null : uri(file)));
        host.notify("trust", obj("trusted", com.intellij.ide.impl.TrustedProjects.isTrusted(project)));
    }
    Object operation(String method, JsonObject p) throws Exception {
        switch (method) {
            case "document.read": { VirtualFile file = file(str(p, "uri")); Document doc = document(file); return snapshot(file, doc, "open"); }
            case "documents.save": FileDocumentManager.getInstance().saveAllDocuments(); return FileDocumentManager.getInstance().getUnsavedDocuments().length == 0;
            case "documents.edit": return edit(p);
            case "editor.open": {
                VirtualFile file;
                if (p.has("text")) { file = new LightVirtualFile(Path.of(java.net.URI.create(str(p, "uri")).getPath()).getFileName().toString(), str(p, "text")); file.setWritable(false); }
                else file = file(str(p, "uri"));
                JsonObject range = object(p, "selection"); JsonObject at = object(range, "start");
                new OpenFileDescriptor(project, file, at.has("line") ? at.get("line").getAsInt() : 0, at.has("character") ? at.get("character").getAsInt() : 0).navigate(true);
                return true;
            }
            case "editor.select": case "editor.reveal": {
                Editor editor = findEditor(str(p, "uri")); if (editor == null) return null;
                JsonObject range = object(p, method.equals("editor.select") ? "selection" : "range");
                int start = offset(editor.getDocument(), object(range, "start")), end = offset(editor.getDocument(), object(range, "end"));
                if (method.equals("editor.select")) { editor.getCaretModel().moveToOffset(end); editor.getSelectionModel().setSelection(start, end); }
                editor.getScrollingModel().scrollTo(editor.offsetToLogicalPosition(start), ScrollType.CENTER); return null;
            }
            case "editor.diff": {
                var factory = DiffContentFactory.getInstance();
                DiffManager.getInstance().showDiff(project, new SimpleDiffRequest(str(p, "title"), factory.create(project, str(p, "left")), factory.create(project, str(p, "right")), str(p, "leftName"), str(p, "rightName"))); return null;
            }
            case "files.refresh": LocalFileSystem.getInstance().refreshAndFindFileByNioFile(Path.of(java.net.URI.create(str(p, "uri")))); return null;
            case "diagnostics": setDiagnostics(p); return null;
            case "diagnostics.clear": clearDiagnostics(); return null;
            case "editor.decorations": {
                String key = str(p, "uri") + "|" + str(p, "key"); decorationData.put(key, p);
                for (Editor editor : findEditors(str(p, "uri"))) renderDecorations(editor, p); return null;
            }
            case "editor.clearDecorations": {
                String key = str(p, "key"); decorationData.entrySet().removeIf(entry -> str(entry.getValue(), "key").equals(key));
                for (Editor editor : new ArrayList<>(decorations.keySet())) clear(editor, key); return null;
            }
            case "editor.lenses": lenses.put(str(p, "uri"), p); for (Editor editor : findEditors(str(p, "uri"))) renderLenses(editor, p); return null;
            case "problems.show": { var window = ToolWindowManager.getInstance(project).getToolWindow("Problems"); if (window != null) window.activate(null); return null; }
            default: throw new IllegalArgumentException("Unsupported native operation: " + method);
        }
    }
    private VirtualFile file(String uri) {
        var file = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(Path.of(java.net.URI.create(uri)));
        if (file == null) throw new IllegalArgumentException("File not found: " + uri); return file;
    }
    private static Document document(VirtualFile file) {
        var document = FileDocumentManager.getInstance().getDocument(file); if (document == null) throw new IllegalArgumentException("Not a text file: " + file.getName()); return document;
    }
    private Object edit(JsonObject p) {
        if (!com.intellij.ide.impl.TrustedProjects.isTrusted(project)) throw new IllegalStateException("Trust this project before applying corrections.");
        record Change(VirtualFile file, Document doc, String before, String after, long version) {}
        List<Change> changes = new ArrayList<>();
        for (JsonElement value : array(p, "changes")) {
            JsonObject change = value.getAsJsonObject(); var file = file(str(change, "uri")); var doc = document(file);
            if (!file.isWritable() || doc.getModificationStamp() != change.get("version").getAsLong() || !doc.getText().equals(str(change, "before"))) return null;
            changes.add(new Change(file, doc, str(change, "before"), str(change, "after"), change.get("version").getAsLong()));
        }
        boolean[] applied = { false };
        WriteCommandAction.runWriteCommandAction(project, "Bananabox corrections", null, () -> {
            // Recheck under the write lock, before changing any document.
            if (changes.stream().anyMatch(change -> change.doc.getModificationStamp() != change.version || !change.doc.getText().equals(change.before))) return;
            for (Change change : changes) {
                int start = 0, beforeEnd = change.before.length(), afterEnd = change.after.length();
                while (start < beforeEnd && start < afterEnd && change.before.charAt(start) == change.after.charAt(start)) start++;
                while (beforeEnd > start && afterEnd > start && change.before.charAt(beforeEnd - 1) == change.after.charAt(afterEnd - 1)) { beforeEnd--; afterEnd--; }
                change.doc.replaceString(start, beforeEnd, change.after.substring(start, afterEnd));
            }
            applied[0] = true;
        });
        if (!applied[0]) return null;
        if (bool(p, "save")) {
            savingCorrection = true;
            try { changes.forEach(change -> FileDocumentManager.getInstance().saveDocument(change.doc)); }
            finally { savingCorrection = false; }
        }
        return changes.stream().map(change -> snapshot(change.file, change.doc, "change")).toList();
    }
    private List<Editor> findEditors(String uri) {
        List<Editor> result = new ArrayList<>();
        for (Editor editor : EditorFactory.getInstance().getAllEditors()) {
            if (editor.getProject() != project || editor.isDisposed()) continue;
            VirtualFile file = FileDocumentManager.getInstance().getFile(editor.getDocument());
            if (file != null && uri(file).equals(uri)) result.add(editor);
        }
        return result;
    }
    private Editor findEditor(String uri) { return findEditors(uri).stream().findFirst().orElse(null); }
    static int offset(Document doc, JsonObject point) {
        int line = point.has("line") ? point.get("line").getAsInt() : 0, column = point.has("character") ? point.get("character").getAsInt() : 0;
        line = Math.max(0, Math.min(line, doc.getLineCount() - 1));
        return Math.min(doc.getLineEndOffset(line), doc.getLineStartOffset(line) + Math.max(0, column));
    }
    private boolean current(Editor editor, JsonObject p) { return !p.has("version") || p.get("version").isJsonNull() || editor.getDocument().getModificationStamp() == p.get("version").getAsLong(); }
    private void setDiagnostics(JsonObject p) {
        String uri = str(p, "uri"); Editor editor = findEditor(uri);
        if (editor != null && !current(editor, p)) return;
        diagnostics.put(uri, p);
        var collector = ProblemsCollector.getInstance(project);
        for (var old : problems.getOrDefault(uri, List.of())) collector.problemDisappeared(old);
        List<FileProblem> next = new ArrayList<>(); VirtualFile file;
        try { file = file(uri); } catch (RuntimeException error) { problems.remove(uri); return; }
        for (JsonElement value : array(p, "diagnostics")) {
            JsonObject diagnostic = value.getAsJsonObject(), at = object(object(diagnostic, "range"), "start");
            FileProblem problem = new FileProblem() {
                @Override public @NotNull VirtualFile getFile() { return file; }
                @Override public @NotNull ProblemsProvider getProvider() { return provider; }
                @Override public @NotNull String getText() { return str(diagnostic, "message"); }
                @Override public String getGroup() { return "Bananabox Coding Style"; }
                @Override public int getLine() { return at.get("line").getAsInt(); }
                @Override public int getColumn() { return at.get("character").getAsInt(); }
                @Override public Icon getIcon() { return severity(diagnostic) == 0 ? com.intellij.icons.AllIcons.General.Error : severity(diagnostic) == 1 ? com.intellij.icons.AllIcons.General.Warning : com.intellij.icons.AllIcons.General.Information; }
            };
            next.add(problem); collector.problemAppeared(problem);
        }
        problems.put(uri, next); for (Editor open : findEditors(uri)) renderDiagnostics(open, p);
    }
    private static int severity(JsonObject diagnostic) { return diagnostic.has("severity") ? diagnostic.get("severity").getAsInt() : 0; }
    private void renderDiagnostics(Editor editor, JsonObject p) {
        if (!current(editor, p)) return; clear(editor, "diagnostics");
        for (JsonElement value : array(p, "diagnostics")) {
            JsonObject diagnostic = value.getAsJsonObject(), range = object(diagnostic, "range");
            int start = offset(editor.getDocument(), object(range, "start")), end = offset(editor.getDocument(), object(range, "end"));
            Color color = color(severity(diagnostic) == 0 ? "#f28b82" : severity(diagnostic) == 1 ? "#e5c07b" : "#80c7d9");
            var attributes = new TextAttributes(null, null, color, EffectType.WAVE_UNDERSCORE, Font.PLAIN);
            var mark = editor.getMarkupModel().addRangeHighlighter(start, end, HighlighterLayer.WARNING, attributes, HighlighterTargetArea.EXACT_RANGE);
            mark.setErrorStripeMarkColor(color); mark.setErrorStripeTooltip(str(diagnostic, "message"));
            remember(editor, "diagnostics", mark::dispose);
        }
    }
    private void renderCached(Editor editor, String uri) {
        if (diagnostics.containsKey(uri)) renderDiagnostics(editor, diagnostics.get(uri));
        for (var p : decorationData.values()) if (str(p, "uri").equals(uri)) renderDecorations(editor, p);
        if (lenses.containsKey(uri)) renderLenses(editor, lenses.get(uri));
    }
    private void renderDecorations(Editor editor, JsonObject p) {
        if (!current(editor, p)) return;
        String key = str(p, "key"); clear(editor, key); JsonObject options = object(p, "options");
        for (JsonElement value : array(p, "decorations")) {
            JsonObject decoration = value.getAsJsonObject(), range = object(decoration, "range"), after = object(options, "after").deepCopy();
            object(object(decoration, "renderOptions"), "after").entrySet().forEach(entry -> after.add(entry.getKey(), entry.getValue()));
            int start = offset(editor.getDocument(), object(range, "start")), end = offset(editor.getDocument(), object(range, "end"));
            String tooltip = markdown(decoration.get("hoverMessage"));
            Label renderer = new Label(str(after, "contentText"), color(after.get("color")), color(after.get("backgroundColor")), tooltip, null, str(after, "fontWeight").equals("600"), str(after, "fontStyle").equals("italic"), gap(str(after, "margin")));
            Inlay<?> inlay = editor.getInlayModel().addAfterLineEndElement(end, true, renderer); if (inlay != null) remember(editor, key, inlay);
            if (!str(options, "borderWidth").isEmpty() && !str(options, "borderWidth").equals("0")) {
                var mark = editor.getMarkupModel().addRangeHighlighter(start, end, HighlighterLayer.ADDITIONAL_SYNTAX, new TextAttributes(null, null, color(options.get("borderColor")), EffectType.LINE_UNDERSCORE, Font.PLAIN), HighlighterTargetArea.EXACT_RANGE);
                remember(editor, key, mark::dispose);
            }
        }
    }
    private static int gap(String margin) {
        var match = java.util.regex.Pattern.compile("(\\d+)(?:ch|em)$").matcher(margin); return match.find() ? Integer.parseInt(match.group(1)) : 0;
    }
    private void renderLenses(Editor editor, JsonObject p) {
        if (!current(editor, p)) return; clear(editor, "lenses");
        Map<Integer, List<JsonObject>> grouped = new LinkedHashMap<>();
        for (JsonElement value : array(p, "lenses")) {
            JsonObject lens = value.getAsJsonObject(); int at = offset(editor.getDocument(), object(object(lens, "range"), "start"));
            grouped.computeIfAbsent(at, ignored -> new ArrayList<>()).add(object(lens, "command"));
        }
        for (var entry : grouped.entrySet()) {
            List<Label> labels = new ArrayList<>();
            for (int i = 0; i < entry.getValue().size(); i++) {
                JsonObject command = entry.getValue().get(i);
                Label label = new Label(str(command, "title").replaceAll("\\$\\([^)]+\\)", ""), UIUtil.getContextHelpForeground(), null, str(command, "tooltip"), command, false, false, 1);
                labels.add(label);
            }
            var inlay = editor.getInlayModel().addBlockElement(entry.getKey(), true, true, 100, new Row(labels));
            if (inlay != null) remember(editor, "lenses", inlay);
        }
    }
    private void remember(Editor editor, String key, Disposable item) { decorations.computeIfAbsent(editor, ignored -> new HashMap<>()).computeIfAbsent(key, ignored -> new ArrayList<>()).add(item); }
    private void clear(Editor editor, String key) {
        var values = decorations.get(editor); if (values == null) return;
        var items = values.remove(key); if (items != null) items.forEach(Disposable::dispose);
    }
    private void clearEditor(Editor editor) { var values = decorations.remove(editor); if (values != null) values.values().forEach(items -> items.forEach(Disposable::dispose)); }
    private void clearDiagnostics() {
        var collector = ProblemsCollector.getInstance(project); problems.values().forEach(items -> items.forEach(collector::problemDisappeared)); problems.clear(); diagnostics.clear();
        for (Editor editor : new ArrayList<>(decorations.keySet())) clear(editor, "diagnostics");
    }
    void clear() { for (Editor editor : new ArrayList<>(decorations.keySet())) clearEditor(editor); clearDiagnostics(); lenses.clear(); decorationData.clear(); }
    void context(String key, JsonElement value) { if (key.equals("bananabox.codingStyle.hasCorrections")) hasCorrections = value.getAsBoolean(); }
    JsonArray quickFixDiagnostics(Editor editor) {
        VirtualFile file = FileDocumentManager.getInstance().getFile(editor.getDocument()); if (file == null) return new JsonArray();
        JsonObject data = diagnostics.get(uri(file)); if (data == null || !current(editor, data)) return new JsonArray();
        int line = editor.getCaretModel().getLogicalPosition().line; JsonArray result = new JsonArray();
        for (var value : array(data, "diagnostics")) {
            var d = value.getAsJsonObject();
            if (object(object(d, "range"), "start").get("line").getAsInt() == line && (str(d, "message").toLowerCase(Locale.ROOT).contains("trailing") || d.has("code") && d.get("code").toString().contains("C-G7"))) result.add(d);
        }
        return result;
    }
    void quickFix(Editor editor) {
        var file = FileDocumentManager.getInstance().getFile(editor.getDocument()); if (file != null) host.notify("codeActions", obj("uri", uri(file), "line", editor.getCaretModel().getLogicalPosition().line, "diagnostics", quickFixDiagnostics(editor)));
    }
    void updateStatus(Collection<JsonObject> values) {
        StatusBar bar = WindowManager.getInstance().getStatusBar(project); if (bar == null) return;
        if (status == null) { status = new Status(); bar.addWidget(status, host); }
        status.values = values.stream().filter(value -> bool(value, "visible")).toList(); bar.updateWidget(status.ID());
    }
    private final class Status implements StatusBarWidget, StatusBarWidget.TextPresentation {
        List<JsonObject> values = List.of();
        @Override public @NotNull String ID() { return "Bananabox.Status"; }
        @Override public WidgetPresentation getPresentation() { return this; }
        @Override public @NotNull String getText() { return values.stream().map(value -> str(value, "text").replaceAll("\\$\\([^)]+\\)", "").trim()).reduce((a, b) -> a + " · " + b).orElse(""); }
        @Override public float getAlignment() { return 0; }
        @Override public String getTooltipText() { return values.stream().map(value -> markdown(value.get("tooltip"))).reduce((a, b) -> a + "\n" + b).orElse("Bananabox"); }
        @Override public com.intellij.util.Consumer<MouseEvent> getClickConsumer() { return event -> {
            JPopupMenu menu = new JPopupMenu(); for (JsonObject value : values) { JMenuItem item = new JMenuItem(str(value, "text").replaceAll("\\$\\([^)]+\\)", "")); item.addActionListener(e -> host.command(str(value, "command"))); menu.add(item); } menu.show(event.getComponent(), event.getX(), event.getY());
        }; }
    }
    private static String markdown(JsonElement value) { if (value == null || value.isJsonNull()) return ""; return value.isJsonObject() ? str(value.getAsJsonObject(), "value") : value.getAsString(); }
    private static Color color(String value) { return color(new JsonPrimitive(value)); }
    private static Color color(JsonElement value) {
        if (value == null || value.isJsonNull()) return UIUtil.getLabelForeground();
        String text = value.isJsonObject() ? str(value.getAsJsonObject(), "id") : value.getAsString();
        if (text.equals("transparent")) return null;
        if (text.matches("#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?")) {
            int rgb = Integer.parseInt(text.substring(1, 7), 16); return new Color(rgb >> 16, (rgb >> 8) & 255, rgb & 255, text.length() == 9 ? Integer.parseInt(text.substring(7), 16) : 255);
        }
        boolean dark = UIUtil.isUnderDarcula();
        String rgb = text.contains("fatal") ? (dark ? "#f28b82" : "#b3261e") : text.contains("major") ? (dark ? "#e5c07b" : "#805700") : text.contains("minor") ? (dark ? "#80c7d9" : "#006779") : text.contains("info") ? (dark ? "#b5a2e0" : "#6941a5") : text.contains("Passed") ? "#79b879" : dark ? "#a6a6a6" : "#616161";
        return color(rgb + (text.endsWith("Background") || text.endsWith("background") ? "18" : text.endsWith("Underline") ? "70" : ""));
    }
    private static final class Label implements EditorCustomElementRenderer {
        final String text, tooltip; final Color foreground, background; final JsonObject command; final boolean bold, italic; final int gap;
        Label(String text, Color foreground, Color background, String tooltip, JsonObject command, boolean bold, boolean italic, int gap) { this.text = text; this.foreground = foreground; this.background = background; this.tooltip = tooltip; this.command = command; this.bold = bold; this.italic = italic; this.gap = gap; }
        private Font font(Inlay<?> inlay) { var scheme = inlay.getEditor().getColorsScheme(); return new Font(scheme.getEditorFontName(), (bold ? Font.BOLD : 0) | (italic ? Font.ITALIC : 0), Math.max(10, scheme.getEditorFontSize() - (command == null ? 0 : 2))); }
        @Override public int calcWidthInPixels(@NotNull Inlay inlay) { var metrics = inlay.getEditor().getContentComponent().getFontMetrics(font(inlay)); return Math.max(1, metrics.stringWidth(text) + metrics.charWidth(' ') * gap + 8); }
        @Override public int calcHeightInPixels(@NotNull Inlay inlay) { return inlay.getEditor().getLineHeight(); }
        @Override public void paint(@NotNull Inlay inlay, @NotNull Graphics graphics, @NotNull Rectangle bounds, @NotNull TextAttributes attributes) {
            graphics.setFont(font(inlay)); FontMetrics metrics = graphics.getFontMetrics(); int left = bounds.x + metrics.charWidth(' ') * gap;
            if (background != null) { graphics.setColor(background); graphics.fillRoundRect(left, bounds.y, bounds.width - (left - bounds.x), bounds.height, 4, 4); }
            graphics.setColor(foreground); graphics.drawString(text, left + 3, bounds.y + (bounds.height - metrics.getHeight()) / 2 + metrics.getAscent());
        }
    }
    private static final class Row implements EditorCustomElementRenderer {
        final List<Label> labels;
        Row(List<Label> labels) { this.labels = labels; }
        @Override public int calcWidthInPixels(@NotNull Inlay inlay) { return Math.max(1, labels.stream().mapToInt(label -> label.calcWidthInPixels(inlay)).sum()); }
        @Override public int calcHeightInPixels(@NotNull Inlay inlay) { return inlay.getEditor().getLineHeight(); }
        Label at(Inlay<?> inlay, int x) {
            Rectangle bounds = inlay.getBounds(); if (bounds == null) return null;
            int left = bounds.x;
            for (Label label : labels) { int width = label.calcWidthInPixels(inlay); if (x >= left && x < left + width) return label; left += width; }
            return null;
        }
        @Override public void paint(@NotNull Inlay inlay, @NotNull Graphics graphics, @NotNull Rectangle bounds, @NotNull TextAttributes attributes) {
            int x = bounds.x;
            for (Label label : labels) { int width = label.calcWidthInPixels(inlay); label.paint(inlay, graphics, new Rectangle(x, bounds.y, width, bounds.height), attributes); x += width; }
        }
    }
    @Override public void dispose() { if (ApplicationManager.getApplication().isDispatchThread()) clear(); else ui(this::clear); }
}
