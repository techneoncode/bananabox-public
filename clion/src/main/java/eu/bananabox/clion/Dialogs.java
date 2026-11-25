package eu.bananabox.clion;

import com.google.gson.*;
import com.intellij.notification.*;
import com.intellij.openapi.fileChooser.*;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.vfs.LocalFileSystem;
import com.intellij.openapi.wm.WindowManager;
import javax.swing.*;
import javax.swing.event.*;
import java.awt.*;
import java.nio.file.Path;
import java.util.*;
import static eu.bananabox.clion.Host.*;

final class Dialogs {
    static Object message(Project project, JsonObject p) {
        JsonArray items = array(p, "items"); JsonObject options = object(p, "options");
        String text = str(p, "text") + (str(options, "detail").isEmpty() ? "" : "\n\n" + str(options, "detail"));
        if (items.isEmpty() && !bool(options, "modal")) {
            NotificationType type = str(p, "level").equals("error") ? NotificationType.ERROR : str(p, "level").equals("warning") ? NotificationType.WARNING : NotificationType.INFORMATION;
            NotificationGroupManager.getInstance().getNotificationGroup("Bananabox").createNotification(text, type).notify(project); return null;
        }
        String[] labels = new String[items.size() + 1];
        for (int i = 0; i < items.size(); i++) labels[i] = items.get(i).getAsString(); labels[items.size()] = "Cancel";
        // Cancel is always the default: Enter must never consume a grader token accidentally.
        int answer = Messages.showDialog(project, text, "Bananabox", labels, labels.length - 1, Messages.getQuestionIcon());
        return answer < 0 || answer >= items.size() ? null : answer;
    }
    static String input(Project project, JsonObject p) {
        String prompt = str(p, "prompt") + (str(p, "error").isEmpty() ? "" : "\n" + str(p, "error"));
        String title = str(p, "title").isEmpty() ? "Bananabox" : str(p, "title");
        if (bool(p, "password")) return Messages.showPasswordDialog(project, prompt, title, Messages.getQuestionIcon());
        return Messages.showInputDialog(project, prompt, title, Messages.getQuestionIcon(), str(p, "value"), null);
    }
    record Choice(int index, String label) { @Override public String toString() { return label; } }
    static Object pick(Project project, JsonObject p) {
        var choices = new ArrayList<Choice>(); JsonArray items = array(p, "items"); JsonObject options = object(p, "options");
        for (int i = 0; i < items.size(); i++) {
            JsonObject item = items.get(i).getAsJsonObject();
            String text = str(item, "label") + (str(item, "description").isBlank() ? "" : " — " + str(item, "description")) + (str(item, "detail").isBlank() ? "" : " · " + str(item, "detail"));
            choices.add(new Choice(i, text.replaceAll("\\$\\([^)]+\\)", "").trim()));
        }
        DefaultListModel<Choice> model = new DefaultListModel<>(); model.addAll(choices);
        JList<Choice> list = new JList<>(model); boolean multiple = bool(options, "canPickMany");
        list.setSelectionMode(multiple ? ListSelectionModel.MULTIPLE_INTERVAL_SELECTION : ListSelectionModel.SINGLE_SELECTION);
        if (multiple) for (int i = 0; i < items.size(); i++) if (bool(items.get(i).getAsJsonObject(), "picked")) list.addSelectionInterval(i, i);
        JTextField filter = new JTextField();
        filter.getDocument().addDocumentListener(new DocumentListener() {
            void change() { String query = filter.getText().toLowerCase(Locale.ROOT); model.clear(); choices.stream().filter(choice -> choice.label.toLowerCase(Locale.ROOT).contains(query)).forEach(model::addElement); }
            public void insertUpdate(DocumentEvent e) { change(); } public void removeUpdate(DocumentEvent e) { change(); } public void changedUpdate(DocumentEvent e) { change(); }
        });
        JPanel panel = new JPanel(new BorderLayout(0, 8)); JPanel header = new JPanel(new BorderLayout(0, 4));
        header.add(new JLabel(str(options, "placeHolder") + (multiple ? " (Ctrl/Shift: multiple selection)" : "")), BorderLayout.NORTH); header.add(filter);
        panel.add(header, BorderLayout.NORTH); JScrollPane scroll = new JScrollPane(list); scroll.setPreferredSize(new Dimension(720, 320)); panel.add(scroll);
        int answer = JOptionPane.showConfirmDialog(WindowManager.getInstance().getFrame(project), panel, str(options, "title").isBlank() ? "Bananabox" : str(options, "title"), JOptionPane.OK_CANCEL_OPTION, JOptionPane.PLAIN_MESSAGE);
        if (answer != JOptionPane.OK_OPTION || (!multiple && list.isSelectionEmpty())) return null;
        return list.getSelectedValuesList().stream().map(Choice::index).toList();
    }
    static Object open(Project project, JsonObject p) {
        boolean folders = bool(p, "canSelectFolders");
        var descriptor = new FileChooserDescriptor(!folders, folders, false, false, false, bool(p, "canSelectMany"));
        descriptor.setTitle(str(p, "title").isBlank() ? "Bananabox" : str(p, "title"));
        var filters = object(p, "filters");
        if (!filters.isEmpty()) {
            Set<String> extensions = new HashSet<>(); filters.entrySet().forEach(entry -> entry.getValue().getAsJsonArray().forEach(value -> extensions.add(value.getAsString().toLowerCase(Locale.ROOT))));
            descriptor.withFileFilter(file -> file.isDirectory() || extensions.contains(Objects.toString(file.getExtension(), "").toLowerCase(Locale.ROOT)));
        }
        var initial = str(p, "defaultUri").isBlank() ? null : LocalFileSystem.getInstance().findFileByNioFile(Path.of(java.net.URI.create(str(p, "defaultUri"))));
        var files = FileChooser.chooseFiles(descriptor, project, initial);
        return files.length == 0 ? null : Arrays.stream(files).map(file -> file.getPath()).toList();
    }
    static Object save(Project project, JsonObject p) {
        var dialog = FileChooserFactory.getInstance().createSaveFileDialog(new FileSaverDescriptor(str(p, "title").isBlank() ? "Bananabox" : str(p, "title"), ""), project);
        Path initial = str(p, "defaultUri").isBlank() ? Path.of(System.getProperty("user.home"), "subject.pdf") : Path.of(java.net.URI.create(str(p, "defaultUri")));
        var folder = LocalFileSystem.getInstance().findFileByNioFile(initial.getParent());
        var result = dialog.save(folder, initial.getFileName().toString()); return result == null ? null : result.getFile().getAbsolutePath();
    }
}
