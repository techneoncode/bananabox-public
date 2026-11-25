package eu.bananabox.clion;

import com.intellij.openapi.project.*;
import com.intellij.openapi.wm.*;
import org.jetbrains.annotations.NotNull;

public final class BananaboxToolWindow implements ToolWindowFactory, DumbAware {
    @Override public void createToolWindowContent(@NotNull Project project, @NotNull ToolWindow window) { project.getService(Host.class).attach(window); }
}
