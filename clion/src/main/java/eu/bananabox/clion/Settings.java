package eu.bananabox.clion;

import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.components.*;
import org.jetbrains.annotations.NotNull;

@State(name = "Bananabox", storages = @Storage("bananabox.xml"))
public final class Settings implements PersistentStateComponent<Settings.Data> {
    public static final class Data {
        public String nodeExecutable = "node";
        public String settings = "{}";
        public String memento = "{}";
    }
    private Data data = new Data();
    public static Settings get() { return ApplicationManager.getApplication().getService(Settings.class); }
    @Override public @NotNull Data getState() { return data; }
    @Override public void loadState(@NotNull Data state) { data = state; }
}
