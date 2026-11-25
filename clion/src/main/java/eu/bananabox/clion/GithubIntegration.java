package eu.bananabox.clion;

import com.google.gson.JsonObject;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.Project;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Callable;
import kotlin.coroutines.EmptyCoroutineContext;
import kotlinx.coroutines.BuildersKt;
import org.jetbrains.plugins.github.api.GithubServerPath;
import org.jetbrains.plugins.github.authentication.*;
import org.jetbrains.plugins.github.authentication.accounts.*;
import org.jetbrains.plugins.github.authentication.ui.GithubChooseAccountDialog;
import static eu.bananabox.clion.Host.*;

/** Loaded only when JetBrains' GitHub plugin is enabled. Secrets stay in its account manager. */
public final class GithubIntegration implements GithubSessions {
    @Override public synchronized JsonObject session(Project project, boolean interactive) throws Exception {
        if (project.isDisposed()) return null;
        var accounts = GHAccountsUtil.getAccounts().stream().filter(a -> a.getServer().isGithubDotCom()).toList();
        String preferred = project.getService(ProjectSettings.class).getState().githubAccountId;
        GithubAccount account = accounts.stream().filter(a -> a.getId().equals(preferred)).findFirst().orElse(null);
        if (account == null) account = GHAccountsUtil.getDefaultAccount(project);
        if (!accounts.contains(account)) account = accounts.size() == 1 ? accounts.getFirst() : null;
        if (account == null && !interactive) return null;
        if (account == null && !accounts.isEmpty()) {
            account = onUi(project, () -> {
                var dialog = new GithubChooseAccountDialog(project, null, accounts, "Bananabox · GitHub", false, true);
                if (!dialog.showAndGet()) return null;
                if (dialog.getSetDefault()) GHAccountsUtil.setDefaultAccount(project, dialog.getAccount());
                return dialog.getAccount();
            });
            if (account == null) return null;
        }
        if (account == null) {
            GHAccountAuthData login = onUi(project, () -> GHAccountsUtil.requestNewAccount(
                GithubServerPath.DEFAULT_SERVER, null, project, null, AuthorizationType.OAUTH, GHLoginSource.UNKNOWN));
            return login == null ? null : sessionData(project, login.getAccount(), login.getToken());
        }
        var manager = ApplicationManager.getApplication().getService(GHAccountManager.class);
        GithubAccount selected = account;
        // This method is invoked on the pooled thread, never on the EDT.
        String token = BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, continuation) -> manager.findCredentials(selected, continuation));
        if ((token == null || token.isBlank()) && interactive) {
            GHAccountAuthData login = onUi(project, () -> GHAccountsUtil.requestReLogin(
                selected, project, null, AuthorizationType.OAUTH, GHLoginSource.UNKNOWN));
            return login == null ? null : sessionData(project, login.getAccount(), login.getToken());
        }
        return token == null || token.isBlank() ? null : sessionData(project, account, token);
    }
    private static JsonObject sessionData(Project project, GithubAccount account, String token) {
        project.getService(ProjectSettings.class).getState().githubAccountId = account.getId();
        return obj("accessToken", token, "account", obj("label", account.getName(), "id", account.getId()),
            "id", account.getId(), "scopes", new String[]{"repo"});
    }
    private static <T> T onUi(Project project, Callable<T> action) throws Exception {
        CompletableFuture<T> answer = new CompletableFuture<>();
        ui(() -> {
            try { answer.complete(project.isDisposed() ? null : action.call()); }
            catch (Throwable error) { answer.completeExceptionally(error); }
        });
        return answer.get();
    }
}
