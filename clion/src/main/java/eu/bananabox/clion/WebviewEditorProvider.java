package eu.bananabox.clion;

import com.intellij.openapi.fileEditor.*;
import com.intellij.openapi.project.*;
import com.intellij.openapi.util.UserDataHolderBase;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.testFramework.LightVirtualFile;
import org.jetbrains.annotations.NotNull;
import javax.swing.*;
import java.beans.PropertyChangeListener;

public final class WebviewEditorProvider implements FileEditorProvider, DumbAware {
    static final class Page extends LightVirtualFile {
        final Host host;
        final String id;
        final WebviewPanel panel;
        Page(Host host, String id, String title, WebviewPanel panel) { super(title); this.host = host; this.id = id; this.panel = panel; setWritable(false); }
    }
    @Override public boolean accept(@NotNull Project project, @NotNull VirtualFile file) { return file instanceof Page; }
    @Override public @NotNull FileEditor createEditor(@NotNull Project project, @NotNull VirtualFile file) { return new PageEditor((Page)file); }
    @Override public @NotNull String getEditorTypeId() { return "Bananabox.Webview"; }
    @Override public @NotNull FileEditorPolicy getPolicy() { return FileEditorPolicy.HIDE_DEFAULT_EDITOR; }
    private static final class PageEditor extends UserDataHolderBase implements FileEditor {
        private final Page page;
        private boolean closed;
        PageEditor(Page page) { this.page = page; }
        @Override public @NotNull JComponent getComponent() { return page.panel.component(); }
        @Override public JComponent getPreferredFocusedComponent() { return page.panel.component(); }
        @Override public @NotNull String getName() { return "Bananabox"; }
        @Override public void setState(@NotNull FileEditorState state) {}
        @Override public boolean isModified() { return false; }
        @Override public boolean isValid() { return !closed; }
        @Override public void addPropertyChangeListener(@NotNull PropertyChangeListener listener) {}
        @Override public void removePropertyChangeListener(@NotNull PropertyChangeListener listener) {}
        @Override public VirtualFile getFile() { return page; }
        @Override public void dispose() { closed = true; page.host.editorPageClosed(page.id, page.panel); }
    }
}
