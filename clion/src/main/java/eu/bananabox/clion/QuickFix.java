package eu.bananabox.clion;
import com.intellij.codeInsight.intention.IntentionAction;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.project.Project;
import com.intellij.psi.PsiFile;
import org.jetbrains.annotations.NotNull;
public final class QuickFix implements IntentionAction {
    @Override public @NotNull String getText() { return "Bananabox: remove trailing whitespace…"; }
    @Override public @NotNull String getFamilyName() { return "Bananabox Coding Style"; }
    @Override public boolean isAvailable(@NotNull Project project, Editor editor, PsiFile file) { return editor != null && !project.getService(Host.class).editor.quickFixDiagnostics(editor).isEmpty(); }
    @Override public void invoke(@NotNull Project project, Editor editor, PsiFile file) { project.getService(Host.class).editor.quickFix(editor); }
    @Override public boolean startInWriteAction() { return false; }
}
