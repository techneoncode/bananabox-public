package eu.bananabox.clion;

import com.google.gson.*;
import com.intellij.ui.content.Content;
import javax.swing.*;
import javax.swing.event.*;
import javax.swing.tree.*;
import java.awt.event.*;
import static eu.bananabox.clion.Host.*;

final class CommitTree {
    private final Host host;
    private final DefaultMutableTreeNode root = new DefaultMutableTreeNode("Graded commit");
    private final DefaultTreeModel model = new DefaultTreeModel(root);
    private final JTree tree = new JTree(model);
    private long generation;
    Content content;
    record Entry(JsonObject value) { @Override public String toString() { return str(value, "label"); } }
    CommitTree(Host host) {
        this.host = host; tree.setRootVisible(false);
        tree.addTreeWillExpandListener(new TreeWillExpandListener() {
            public void treeWillExpand(TreeExpansionEvent event) { load((DefaultMutableTreeNode)event.getPath().getLastPathComponent()); }
            public void treeWillCollapse(TreeExpansionEvent event) {}
        });
        tree.addMouseListener(new MouseAdapter() { @Override public void mouseClicked(MouseEvent e) { if (SwingUtilities.isLeftMouseButton(e) && e.getClickCount() == 1) open(); } });
        tree.addMouseListener(new MouseAdapter() {
            private void popup(MouseEvent e) {
                if (!e.isPopupTrigger()) return;
                TreePath path = tree.getPathForLocation(e.getX(), e.getY());
                if (path == null) return;
                tree.setSelectionPath(path);
                var node = (DefaultMutableTreeNode)path.getLastPathComponent();
                if (!(node.getUserObject() instanceof Entry entry) || !entry.value.has("command")) return;
                JPopupMenu menu = new JPopupMenu();
                JMenuItem historical = new JMenuItem("Open file at this commit");
                historical.addActionListener(event -> open()); menu.add(historical);
                JMenuItem compare = new JMenuItem("Compare with working file");
                compare.addActionListener(event -> host.command(entry.value.getAsJsonObject("command"))); menu.add(compare);
                menu.show(tree, e.getX(), e.getY());
            }
            @Override public void mousePressed(MouseEvent e) { popup(e); }
            @Override public void mouseReleased(MouseEvent e) { popup(e); }
        });
        tree.getInputMap().put(KeyStroke.getKeyStroke("ENTER"), "open"); tree.getActionMap().put("open", new AbstractAction() { public void actionPerformed(ActionEvent e) { open(); } });
    }
    JComponent component() { return new JScrollPane(tree); }
    void reload() { generation++; root.removeAllChildren(); model.reload(); load(root); }
    private void load(DefaultMutableTreeNode parent) {
        if (parent != root && (parent.getChildCount() != 1 || !"Loading…".equals(parent.getChildAt(0).toString()))) return;
        JsonObject params = obj("id", "bananabox.commits");
        if (parent.getUserObject() instanceof Entry entry) params.addProperty("node", str(entry.value, "id"));
        long current = generation;
        host.request("tree.children", params).whenComplete((result, error) -> ui(() -> {
            if (current != generation) return;
            if (error != null) { host.report(error.getMessage()); return; }
            parent.removeAllChildren();
            for (JsonElement value : result.getAsJsonArray()) {
                JsonObject data = value.getAsJsonObject(); var node = new DefaultMutableTreeNode(new Entry(data));
                if (data.has("collapsibleState") && data.get("collapsibleState").getAsInt() > 0) node.add(new DefaultMutableTreeNode("Loading…"));
                parent.add(node);
            }
            model.reload(parent);
            for (int i = 0; i < parent.getChildCount(); i++) {
                var child = (DefaultMutableTreeNode)parent.getChildAt(i);
                if (child.getUserObject() instanceof Entry entry && entry.value.has("collapsibleState") && entry.value.get("collapsibleState").getAsInt() == 2)
                    tree.expandPath(new TreePath(child.getPath()));
            }
        }));
    }
    private void open() {
        var node = (DefaultMutableTreeNode)tree.getLastSelectedPathComponent();
        if (node != null && node.getUserObject() instanceof Entry entry && entry.value.has("resourceUri")) {
            JsonArray args = new JsonArray(); args.add(entry.value.get("resourceUri"));
            host.command(obj("command", "vscode.open", "arguments", args));
        }
    }
}
