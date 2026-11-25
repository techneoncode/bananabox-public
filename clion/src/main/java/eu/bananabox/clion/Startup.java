package eu.bananabox.clion;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.startup.StartupActivity;
import org.jetbrains.annotations.NotNull;
public final class Startup implements StartupActivity.DumbAware {
    @Override public void runActivity(@NotNull Project project) { project.getService(Host.class).start(); }
}
