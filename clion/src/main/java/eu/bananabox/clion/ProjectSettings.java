package eu.bananabox.clion;

import com.intellij.openapi.components.*;
import org.jetbrains.annotations.NotNull;

@State(name = "BananaboxProject", storages = @Storage(StoragePathMacros.WORKSPACE_FILE))
public final class ProjectSettings implements PersistentStateComponent<ProjectSettings.Data> {
    public static final class Data {
        public String settings = "{}";
        public String memento = "{}";
        public String githubAccountId = "";
    }
    private Data data = new Data();
    @Override public @NotNull Data getState() { return data; }
    @Override public void loadState(@NotNull Data state) { data = state; }
}
