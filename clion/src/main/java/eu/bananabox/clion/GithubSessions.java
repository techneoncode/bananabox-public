package eu.bananabox.clion;

import com.google.gson.JsonObject;
import com.intellij.openapi.project.Project;

/** Optional integration: the rest of Bananabox also works with the bundled GitHub plugin disabled. */
public interface GithubSessions {
    JsonObject session(Project project, boolean interactive) throws Exception;
}
