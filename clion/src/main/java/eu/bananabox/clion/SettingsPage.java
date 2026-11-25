package eu.bananabox.clion;

import com.google.gson.*;
import com.intellij.openapi.options.Configurable;
import com.intellij.openapi.options.ConfigurationException;
import com.intellij.openapi.project.ProjectManager;
import javax.swing.*;
import java.awt.*;

public final class SettingsPage implements Configurable {
    private JTextField node;
    private JTextArea settings;
    @Override public String getDisplayName() { return "Bananabox"; }
    @Override public JComponent createComponent() {
        JPanel panel = new JPanel(new BorderLayout(0, 12));
        JPanel top = new JPanel(new BorderLayout(8, 0));
        node = new JTextField();
        top.add(new JLabel("Node.js 20+ executable:"), BorderLayout.WEST); top.add(node);
        panel.add(top, BorderLayout.NORTH);
        settings = new JTextArea(22, 70);
        JPanel center = new JPanel(new BorderLayout(0, 8));
        center.add(new JLabel("Settings JSON: bananabox.* and bananalens.* keys. Project overrides: Bananabox → Project settings."), BorderLayout.NORTH);
        center.add(new JScrollPane(settings)); panel.add(center);
        panel.add(new JLabel("Appearance and corrections also have dedicated actions in Tools → Bananabox. Restart the engine after changing Node.js."), BorderLayout.SOUTH);
        reset(); return panel;
    }
    @Override public boolean isModified() { return !node.getText().equals(Settings.get().getState().nodeExecutable) || !canonical(settings.getText()).equals(canonical(Settings.get().getState().settings)); }
    static String canonical(String value) { try { return JsonParser.parseString(value).toString(); } catch (RuntimeException e) { return value; } }
    static JsonObject validate(String value) throws ConfigurationException {
        try {
            JsonElement parsed = JsonParser.parseString(value);
            if (!parsed.isJsonObject()) throw new IllegalArgumentException();
            for (String key : parsed.getAsJsonObject().keySet()) if (!key.startsWith("bananabox.") && !key.startsWith("bananalens.")) throw new IllegalArgumentException();
            return parsed.getAsJsonObject();
        } catch (RuntimeException e) { throw new ConfigurationException("Enter a JSON object containing bananabox.* or bananalens.* settings."); }
    }
    @Override public void apply() throws ConfigurationException {
        JsonObject value = validate(settings.getText());
        if (node.getText().isBlank()) throw new ConfigurationException("Choose a Node.js executable.");
        Settings.get().getState().settings = value.toString(); Settings.get().getState().nodeExecutable = node.getText().trim();
        for (var project : ProjectManager.getInstance().getOpenProjects()) project.getService(Host.class).settingsChanged();
    }
    @Override public void reset() {
        node.setText(Settings.get().getState().nodeExecutable);
        settings.setText(new GsonBuilder().setPrettyPrinting().create().toJson(JsonParser.parseString(Settings.get().getState().settings)));
    }
    @Override public void disposeUIResources() { node = null; settings = null; }
}
