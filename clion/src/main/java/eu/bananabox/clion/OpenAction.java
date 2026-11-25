package eu.bananabox.clion;
import com.intellij.openapi.actionSystem.*;
import com.intellij.openapi.project.DumbAwareAction;
import com.intellij.openapi.wm.ToolWindowManager;
import org.jetbrains.annotations.NotNull;
public final class OpenAction extends DumbAwareAction {
    @Override public void actionPerformed(@NotNull AnActionEvent event) {
        if (event.getProject() == null) return;
        var window = ToolWindowManager.getInstance(event.getProject()).getToolWindow("Bananabox");
        if (window != null) window.activate(null);
    }
}
