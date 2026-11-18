
/**
 * French wording for the messages of the Banana plugin and of the Makefile
 * checks. A message with no entry stays as epiclang wrote it.
 */
const EXACT_FR: Record<string, string> = {
    'file not ending with a newline': 'le fichier ne se termine pas par un retour à la ligne',
    'use of goto statement': 'utilisation de l’instruction goto',
    'function name too short': 'nom de fonction trop court',
    'non-snake-case function name': 'nom de fonction qui n’est pas en snake_case',
    'function without parameter': 'fonction sans paramètre (void attendu)',
    'function pointer without parameter': 'pointeur de fonction sans paramètre (void attendu)',
    'comment inside function': 'commentaire à l’intérieur d’une fonction',
    'file not starting with standard Epitech header': 'le fichier ne commence pas par l’en-tête Epitech standard',
    'function not defined on its own line': 'fonction non définie sur sa propre ligne',
    'too many blank lines between function declarations': 'trop de lignes vides entre les déclarations de fonctions',
    'no blank line between function declarations': 'aucune ligne vide entre les déclarations de fonctions',
    'trailing space': 'espace en fin de ligne',
    'trailing empty line': 'ligne vide en fin de fichier',
    'non-header file include': 'inclusion d’un fichier qui n’est pas un en-tête',
    'non-static-inline function in header file': 'fonction non static inline dans un fichier d’en-tête',
    'non-static-inline function in source file': 'fonction non static inline dans un fichier source',
    'function declaration in source file': 'déclaration de fonction dans un fichier source',
    'typedef in source file': 'typedef dans un fichier source',
    '#define in source file': '#define dans un fichier source',
    'file not protected against double inclusion': 'fichier non protégé contre la double inclusion',
    'indentation not done with groups of 4 spaces': 'indentation non faite par groupes de 4 espaces',
    'multiple spaces used for spacing': 'plusieurs espaces utilisés pour séparer',
    'while opening brace not on same line as condition': 'accolade ouvrante du while pas sur la même ligne que la condition',
    'while closing brace not alone on its line': 'accolade fermante du while pas seule sur sa ligne',
    'switch opening brace not on same line as condition': 'accolade ouvrante du switch pas sur la même ligne que la condition',
    'switch closing brace not alone on its line': 'accolade fermante du switch pas seule sur sa ligne',
    'if opening brace not on same line as condition': 'accolade ouvrante du if pas sur la même ligne que la condition',
    'if closing brace not alone on its line': 'accolade fermante du if pas seule sur sa ligne',
    'else keyword not on same line as if closing brace': 'else pas sur la même ligne que l’accolade fermante du if',
    'else opening brace not on same line as else keyword': 'accolade ouvrante du else pas sur la même ligne que else',
    'for opening brace not on same line as condition': 'accolade ouvrante du for pas sur la même ligne que la condition',
    'for closing brace not alone on its line': 'accolade fermante du for pas seule sur sa ligne',
    'do opening brace not on same line as do keyword': 'accolade ouvrante du do pas sur la même ligne que do',
    'while keyword not on same line as do closing brace': 'while pas sur la même ligne que l’accolade fermante du do',
    'function body opening brace on same line as prototype': 'accolade ouvrante du corps de fonction sur la même ligne que le prototype',
    'extra lines before function body opening brace': 'lignes en trop avant l’accolade ouvrante du corps de fonction',
    'function body opening brace not alone on its line': 'accolade ouvrante du corps de fonction pas seule sur sa ligne',
    'function body closing brace not alone on its line': 'accolade fermante du corps de fonction pas seule sur sa ligne',
    'variable not declared at the beginning of the function': 'variable non déclarée au début de la fonction',
    'leading blank line in function body': 'ligne vide au début du corps de fonction',
    'blank line inside variable declaration section': 'ligne vide dans la section de déclaration des variables',
    'missing blank line after variable declaration section': 'ligne vide manquante après la section de déclaration des variables',
    'extra blank line after variable declaration section': 'ligne vide en trop après la section de déclaration des variables',
    'blank line inside non-variable-declaration section': 'ligne vide dans une section qui ne déclare pas de variables',
    'trailing blank line in function body': 'ligne vide à la fin du corps de fonction',
    'enum constant name not in upper snake case': 'nom de constante d’enum pas en SNAKE_CASE majuscule',
    'struct name not in lower snake case': 'nom de struct pas en snake_case minuscule',
    'typedef name not in lower snake case': 'nom de typedef pas en snake_case minuscule',
    'typedef name does not end with _t': 'le nom du typedef ne se termine pas par _t',
    'macro name not in upper snake case': 'nom de macro pas en SNAKE_CASE majuscule',
    'Unrecommended wildcard usage': 'Utilisation déconseillée de wildcard',
    'SRC entry is not a file.': 'L’entrée de SRC n’est pas un fichier.',
    'Missing Epitech header: the Makefile must start with the "## EPITECH PROJECT, <year>" block.':
        'En-tête Epitech manquant : le Makefile doit commencer par le bloc "## EPITECH PROJECT, <année>".',
};

const PATTERNS_FR: Array<[RegExp, string]> = [
    [/^(.+)\(\) is not in the subject's allowed functions\.$/, "$1() n'est pas dans les fonctions autorisées du sujet."],
    // clang
    [/^use of undeclared identifier '(.+)'$/, "utilisation de l'identifiant non déclaré '$1'"],
    [/^implicit declaration of function '(.+)' is invalid in C99$/, "déclaration implicite de la fonction '$1' (invalide en C99)"],
    [/^call to undeclared function '(.+)'; ISO C99 and later do not support implicit function declarations$/, "appel de la fonction non déclarée '$1' ; le C99 et les suivants n'autorisent pas les déclarations implicites"],
    [/^unused variable '(.+)'$/, "variable '$1' inutilisée"],
    [/^unused parameter '(.+)'$/, "paramètre '$1' inutilisé"],
    [/^unused function '(.+)'$/, "fonction '$1' inutilisée"],
    [/^variable '(.+)' set but not used$/, "variable '$1' affectée mais jamais utilisée"],
    [/^variable '(.+)' is uninitialized when used here$/, "variable '$1' non initialisée lors de son utilisation"],
    [/^expected '(.+)' after (.+)$/, "'$1' attendu après $2"],
    [/^expected '(.+)'$/, "'$1' attendu"],
    [/^expected expression$/, 'expression attendue'],
    [/^expected identifier$/, 'identifiant attendu'],
    [/^expected identifier or '\('$/, "identifiant ou '(' attendu"],
    [/^expected declaration or statement at end of input$/, 'déclaration ou instruction attendue en fin de fichier'],
    [/^non-void function '(.+)' should return a value$/, "la fonction non void '$1' doit retourner une valeur"],
    [/^control reaches end of non-void function$/, "le contrôle atteint la fin d'une fonction non void"],
    [/^too few arguments to function call, expected (\d+), have (\d+)$/, "trop peu d'arguments pour l'appel de fonction : $1 attendu(s), $2 fourni(s)"],
    [/^too many arguments to function call, expected (\d+), have (\d+)$/, "trop d'arguments pour l'appel de fonction : $1 attendu(s), $2 fourni(s)"],
    [/^redefinition of '(.+)'$/, "redéfinition de '$1'"],
    [/^conflicting types for '(.+)'$/, "types incompatibles pour '$1'"],
    [/^'(.+)' file not found$/, "fichier '$1' introuvable"],
    [/^unknown type name '(.+)'$/, "nom de type inconnu '$1'"],
    [/^incompatible pointer types (.+)$/, 'types de pointeurs incompatibles $1'],
    [/^incompatible integer to pointer conversion (.+)$/, 'conversion incompatible entier vers pointeur $1'],
    [/^incompatible pointer to integer conversion (.+)$/, 'conversion incompatible pointeur vers entier $1'],
    [/^implicit conversion (.+)$/, 'conversion implicite $1'],
    [/^comparison of integers of different signs: (.+)$/, "comparaison d'entiers de signes différents : $1"],
    [/^format specifies type (.+)$/, 'le format attend le type $1'],
    [/^missing return statement$/, 'instruction return manquante'],
    [/^unused label '(.+)'$/, "étiquette '$1' inutilisée"],
    [/^no member named '(.+)' in (.+)$/, "aucun membre nommé '$1' dans $2"],
    [/^member reference type (.+)$/, 'type de référence de membre $1'],
    [/^assigning to (.+) from (.+)$/, 'affectation à $1 depuis $2'],
    [/^passing (.+) to parameter of type (.+)$/, 'passage de $1 à un paramètre de type $2'],
    [/^returning (.+) from a function with result type (.+)$/, 'retour de $1 depuis une fonction de type $2'],
    [/^array index (.+) is past the end of the array(.*)$/, "l'indice $1 dépasse la fin du tableau$2"],
    [/^initializing (.+) with an expression of (.+)$/, 'initialisation de $1 avec une expression de $2'],
    [/^use of GNU (.+)$/, 'utilisation de $1 GNU'],
    [/^too many errors emitted, stopping now$/, 'trop d\'erreurs, arrêt'],
    [/^nested (.+) statement at depth (\d+)$/, 'instruction $1 imbriquée à la profondeur $2'],
    [/^missing space (before|after) (.+)$/, 'espace manquant $1 $2'],
    [/^preprocessor directive indentation \(should be (.+)\)$/, 'indentation de la directive de préprocesseur (attendu : $1)'],
    [/^Malformed Epitech header: line (\d+) should be (.+)\.$/, 'En-tête Epitech mal formé : la ligne $1 doit être $2.'],
    [/^Line too long \((\d+) > (\d+) columns\)\.$/, 'Ligne trop longue ($1 > $2 colonnes).'],
    [/^Missing rules?: (.+)$/, 'Règle(s) manquante(s) : $1'],
    [/^NAME is (.+) but the subject asks for a binary named (.+)\.$/, 'NAME vaut $1 mais le sujet demande un binaire nommé $2.'],
    [/^No rule builds (.+), the binary name the subject asks for\.$/, 'Aucune règle ne construit $1, le nom de binaire demandé par le sujet.'],
    [/^Missing \.PHONY: declare (.+)\.$/, '.PHONY manquant : déclarer $1.'],
    [/^Not declared in \.PHONY: (.+)\.$/, 'Non déclaré dans .PHONY : $1.'],
    [/^\.PHONY lists (?:rules|a rule) the Makefile does not define: (.+)\.$/, '.PHONY liste des règles que le Makefile ne définit pas : $1.'],
    [/^Missing project files in SRC field: (.+)$/, 'Fichiers du projet absents du champ SRC : $1'],
];

const OPERANDS_FR: Array<[RegExp, string]> = [
    [/^(\w+) keyword$/, 'le mot-clé $1'],
    [/^function call parameter list$/, 'la liste de paramètres d’un appel de fonction'],
    [/^include directive$/, 'la directive include'],
];

const WORDS_FR: Record<string, string> = { before: 'avant', after: 'après' };

/** The message in the given language; unknown messages are returned unchanged. */
export function translateMessage(message: string, language: 'en' | 'fr'): string {
    if (language !== 'fr') return message;
    const exact = EXACT_FR[message];
    if (exact) return exact;
    for (const [pattern, replacement] of PATTERNS_FR) {
        if (!pattern.test(message)) continue;
        return message.replace(pattern, replacement)
            .replace(/^espace manquant (before|after) (.+)$/, (_, side: string, operand: string) => {
                const hit = OPERANDS_FR.find(([re]) => re.test(operand));
                return `espace manquant ${WORDS_FR[side]} ${hit ? operand.replace(hit[0], hit[1]) : operand}`;
            });
    }
    return message;
}

/** The message in the language of the extension (`epibox.language`, else the editor's). */
export function styleLanguage(): 'en' | 'fr' {
    try {
        // Loaded on demand so pure helpers stay usable without the editor.
        const vscode = require('vscode') as typeof import('vscode');
        const setting = vscode.workspace.getConfiguration?.('epibox')
            ?.get?.<string>('language') ?? 'auto';
        return setting === 'fr'
            || (setting !== 'en'
                && (vscode.env?.language ?? '').toLowerCase().startsWith('fr'))
            ? 'fr'
            : 'en';
    } catch {
        return 'en';
    }
}

/** The level tag (`[Unauthorized]`) in the language of the extension. */
export function styleLevel(level: string): string {
    return level === 'Unauthorized' && styleLanguage() === 'fr' ? 'Non autorisée' : level;
}

export function styleMessage(message: string): string {
    return translateMessage(message, styleLanguage());
}

/**
 * UI text of the coding style module. `text` is the English template with
 * `{name}` placeholders; `UI_FR` (keyed by that template) holds the French one.
 */
export function ui(text: string, params?: Record<string, string | number>): string {
    const template = styleLanguage() === 'fr' ? UI_FR[text] ?? text : text;
    return params
        ? template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`))
        : template;
}

/** Phrases of the appearance page's HTML and script, replaced as they are written there. */
const PAGE_FR: Array<[string, string]> = [
    ['Bananabox Coding Style appearance', 'Apparence de Coding Style Bananabox'],
    ['Choose what stays visible while you code. Preview changes here, then apply them to your editor.', 'Choisissez ce qui reste visible pendant que vous codez. Prévisualisez les changements ici, puis appliquez-les à votre éditeur.'],
    ['Save settings for ', 'Enregistrer les réglages pour '],
    ['Settings scope', 'Portée des réglages'],
    ['Content &amp; layout', 'Contenu &amp; mise en page'],
    ['Auto follows Compact / Full mode. Hidden details remain available on hover.', 'Auto suit le mode Compact / Complet. Les détails masqués restent disponibles au survol.'],
    ['Colours by severity', 'Couleurs par gravité'],
    ['Pick a colour or enter a hex value. Add two hex digits for opacity (#RRGGBBAA). Theme keeps your theme’s adaptive colours. Colours also apply to the file summary.', 'Choisissez une couleur ou saisissez une valeur hexadécimale. Ajoutez deux chiffres hexadécimaux pour l’opacité (#RRGGBBAA). Thème conserve les couleurs adaptatives de votre thème. Les couleurs s’appliquent aussi au résumé du fichier.'],
    ['<h2>Preview</h2>', '<h2>Aperçu</h2>'],
    ['Lens preview', 'Aperçu de la lentille'],
    ['>Apply changes<', '>Appliquer les changements<'],
    ['>Reset appearance<', '>Réinitialiser l’apparence<'],
    ['>Theme<', '>Thème<'],
    ['placeholder="Theme default"', 'placeholder="Thème par défaut"'],
    ['Example coding-style diagnostic', 'Exemple de diagnostic de coding style'],
    ["'Fatal', 'C-F1'", "'Fatale', 'C-F1'"],
    ["'Major', 'C-L1'", "'Majeure', 'C-L1'"],
    ["'Minor', 'C-L3'", "'Mineure', 'C-L3'"],
    ["'Info', 'C-G1'", "'Info', 'C-G1'"],
    ["'Unauthorized', ''", "'Non autorisée', ''"],
    ['printf() is not in the subject\'s allowed functions.', 'printf() n’est pas dans les fonctions autorisées du sujet.'],
    ['Unsaved changes', 'Modifications non enregistrées'],
    ['Saving…', 'Enregistrement…'],
    ['Restoring inherited settings…', 'Restauration des réglages hérités…'],
    ["user: 'User', workspace: 'Workspace', folder: 'Workspace folder'", "user: 'Utilisateur', workspace: 'Espace de travail', folder: 'Dossier de l’espace de travail'"],
    ['Appearance saved', 'Apparence enregistrée'],
    ['aria-label="Pick ', 'aria-label="Choisir '],
    ['hexadecimal value', 'valeur hexadécimale'],
];

/** The appearance page in the language of the extension. */
export function localizeHtml(html: string): string {
    if (styleLanguage() !== 'fr') return html;
    return PAGE_FR.reduce((out, [en, fr]) => out.split(en).join(fr), html);
}

export const UI_FR: Record<string, string> = {
    'Display mode': 'Mode d’affichage',
    'Show severity': 'Afficher la gravité',
    'Rule ID': 'Identifiant de règle',
    'Message': 'Message',
    'Show severity square': 'Afficher le carré de gravité',
    'Include compiler warnings': 'Inclure les avertissements du compilateur',
    'Space after code (characters)': 'Espace après le code (caractères)',
    'Messages per line (0 = all)': 'Messages par ligne (0 = tous)',
    'Stacked box for several messages': 'Boîte empilée pour plusieurs messages',
    'Maximum message length': 'Longueur maximale du message',
    'Bold text': 'Texte en gras',
    'Italic text': 'Texte en italique',
    'Message background': 'Arrière-plan du message',
    'Code underline': 'Soulignement du code',
    'Fatal foreground': 'Fatale : texte',
    'Fatal background': 'Fatale : arrière-plan',
    'Fatal underline': 'Fatale : soulignement',
    'Major foreground': 'Majeure : texte',
    'Major background': 'Majeure : arrière-plan',
    'Major underline': 'Majeure : soulignement',
    'Minor foreground': 'Mineure : texte',
    'Minor background': 'Mineure : arrière-plan',
    'Minor underline': 'Mineure : soulignement',
    'Info foreground': 'Info : texte',
    'Info background': 'Info : arrière-plan',
    'Info underline': 'Info : soulignement',
    'Unauthorized function foreground': 'Fonction non autorisée : texte',
    'Unauthorized function background': 'Fonction non autorisée : arrière-plan',
    'Unauthorized function underline': 'Fonction non autorisée : soulignement',
    'Bananabox Coding Style · Appearance': 'Coding Style Bananabox · Apparence',
    'Check the values. Colours accept #RRGGBB or #RRGGBBAA, or an empty value for the theme.':
        'Vérifiez les valeurs. Les couleurs acceptent #RRGGBB ou #RRGGBBAA, ou une valeur vide pour le thème.',
    'Settings could not be saved: {error}': 'Les réglages n’ont pas pu être enregistrés : {error}',
    'No issues': 'Aucune violation',
    '{n} fatal': '{n} fatale',
    '{n} major': '{n} majeure',
    '{n} majors': '{n} majeures',
    '{n} minor': '{n} mineure',
    '{n} minors': '{n} mineures',
    '{n} info': '{n} info',
    '{n} infos': '{n} infos',
    '{n} unauthorized function': '{n} fonction non autorisée',
    '{n} unauthorized functions': '{n} fonctions non autorisées',
    '{n} issue': '{n} violation',
    '{n} issues': '{n} violations',
    '{n} compiler': '{n} compilateur',
    'Not checked': 'Non vérifié',
    'Checking…': 'Vérification…',
    'Check unavailable': 'Vérification indisponible',
    'Pending check': 'Vérification en attente',
    'Bananabox Style': 'Style Bananabox',
    'Bananabox Coding Style': 'Coding Style Bananabox',
    'Off': 'Désactivées',
    'Suggestion': 'Suggestion',
    'Automatic': 'Automatiques',
    '{count} in this file': '{count} dans ce fichier',
    'Fatal: {fatal} · Major: {major} · Minor: {minor} · Info: {info} · Compiler: {other} · Unauthorized functions: {functions}':
        'Fatales : {fatal} · Majeures : {major} · Mineures : {minor} · Infos : {info} · Compilateur : {other} · Fonctions non autorisées : {functions}',
    'The displayed results precede the latest edit. Recheck to refresh them.':
        'Les résultats affichés précèdent la dernière modification. Revérifiez pour les actualiser.',
    'Last check: {error}. Open Bananabox Coding Style output for details.':
        'Dernière vérification : {error}. Ouvrez la sortie Coding Style Bananabox pour les détails.',
    'Corrections: {mode}': 'Corrections : {mode}',
    'Last check took {ms} ms': 'La dernière vérification a pris {ms} ms',
    'Review {count}': 'Examiner : {count}',
    'Browse this file’s diagnostics, grouped by severity and rule':
        'Parcourir les diagnostics de ce fichier, groupés par gravité et par règle',
    '$(refresh) Recheck': '$(refresh) Revérifier',
    '$(play) Check file': '$(play) Vérifier le fichier',
    'Check this file': 'Vérifier ce fichier',
    'Choose Off, Suggestion or Automatic corrections for this workspace':
        'Choisir des corrections désactivées, en suggestion ou automatiques pour cet espace de travail',
    "Bananabox Coding Style formatter": "Formateur Coding Style Bananabox",
    "$(sync~spin) Bananabox Coding Style: preparing corrections": "$(sync~spin) Coding Style Bananabox : préparation des corrections",
    "Preparing the formatter automatically. Editing and saving remain available.": "Préparation automatique du formateur. L’édition et l’enregistrement restent disponibles.",
    "$(warning) Bananabox Coding Style: corrections unavailable": "$(warning) Coding Style Bananabox : corrections indisponibles",
    "Click for details. Preparation retries on the next save after a one-minute cooldown.": "Cliquez pour les détails. La préparation est retentée au prochain enregistrement, après une minute d’attente.",
    "$(circle-slash) Off": "$(circle-slash) Désactivées",
    "Default": "Par défaut",
    "Keep Banana scans without automatic corrections.": "Garder les analyses Banana sans corrections automatiques.",
    "$(lightbulb) Suggestion": "$(lightbulb) Suggestion",
    "Review before applying": "À relire avant application",
    "Each fix appears inline after saving: Tab accepts it, Alt+] goes to the next one, Esc dismisses.": "Chaque correction s’affiche en ligne après l’enregistrement : Tab l’accepte, Alt+] passe à la suivante, Échap la rejette.",
    "$(check) Automatic": "$(check) Automatiques",
    "Apply safe layout corrections while saving.": "Appliquer les corrections de mise en page sûres à l’enregistrement.",
    "Bananabox Coding Style · correction mode": "Coding Style Bananabox · mode de correction",
    "Choose how corrections should work": "Choisissez le fonctionnement des corrections",
    "Adding the Epitech file header (C-G1)": "Ajout de l’en-tête Epitech du fichier (C-G1)",
    "Corrections skipped: verification was incomplete or introduced a diagnostic.": "Corrections ignorées : la vérification était incomplète ou a introduit un diagnostic.",
    "Corrections skipped: {error}. See the Bananabox Coding Style output for formatter preparation details.": "Corrections ignorées : {error}. Voir la sortie Coding Style Bananabox pour les détails de préparation du formateur.",
    "fixes {rules}": "corrige {rules}",
    "Accept this correction": "Accepter cette correction",
    "Accept (Tab)": "Accepter (Tab)",
    "Accept all {count} ({key} + Alt + Enter)": "Tout accepter ({count}) ({key} + Alt + Entrée)",
    "Next correction (Alt+]) · previous (Alt+[)": "Correction suivante (Alt+]) · précédente (Alt+[)",
    "View diff": "Voir le diff",
    "Compare the whole file with every correction applied": "Comparer le fichier entier avec toutes les corrections appliquées",
    "Dismiss (Esc)": "Ignorer (Échap)",
    "Hide these suggestions until the next save": "Masquer ces suggestions jusqu’au prochain enregistrement",
    "Bananabox Coding Style · suggested corrections": "Coding Style Bananabox · corrections suggérées",
    "Tab to accept, Alt+] for the next one, Esc to dismiss": "Tab pour accepter, Alt+] pour la suivante, Échap pour ignorer",
    "Epitech header ({n} lines)": "en-tête Epitech ({n} lignes)",
    "blank line": "ligne vide",
    "Add the Epitech header (C-G1)": "Ajouter l’en-tête Epitech (C-G1)",
    "Add the final newline": "Ajouter le retour à la ligne final",
    "Remove trailing whitespace": "Supprimer les espaces en fin de ligne",
    "Fix spacing": "Corriger l’espacement",
    "Fix indentation and trailing whitespace": "Corriger l’indentation et les espaces en fin de ligne",
    "Fix indentation": "Corriger l’indentation",
    "Fix indentation of {n} lines": "Corriger l’indentation de {n} lignes",
    "Put the brace on its own line": "Mettre l’accolade sur sa propre ligne",
    "Split into several lines": "Séparer en plusieurs lignes",
    "Join these lines": "Regrouper ces lignes",
    "Reformat this block": "Reformater ce bloc",
    "Remove this blank line": "Supprimer cette ligne vide",
    "Remove {n} blank lines": "Supprimer {n} lignes vides",
    "Add a blank line": "Ajouter une ligne vide",
    "Add {n} blank lines": "Ajouter {n} lignes vides",
    "Removing the blank line": "Suppression de la ligne vide",
    "Removing {n} blank lines": "Suppression de {n} lignes vides",
    "Removing trailing whitespace": "Suppression des espaces en fin de ligne",
    "Using Unix line endings": "Utilisation des fins de ligne Unix",
    "Adding the final newline": "Ajout du retour à la ligne final",
    "Correcting indentation": "Correction de l’indentation",
    "Correcting spacing": "Correction de l’espacement",
    "Adjusting braces and line breaks": "Ajustement des accolades et des retours à la ligne",
    "Adding a separating blank line": "Ajout d’une ligne vide de séparation",
    "Correcting code layout": "Correction de la mise en page du code",
    "Bananabox Coding Style: {error}": "Coding Style Bananabox : {error}",
    "Bananabox Coding Style: epiclang returned {code} but no diagnostic could be parsed. See the Bananabox Coding Style output.": "Coding Style Bananabox : epiclang a retourné {code} mais aucun diagnostic n’a pu être lu. Voir la sortie Coding Style Bananabox.",
    "Locate epiclang…": "Localiser epiclang…",
    "Open settings": "Ouvrir les réglages",
    "Select the epiclang executable": "Sélectionner l’exécutable epiclang",
    "Use this executable": "Utiliser cet exécutable",
    "Coding style is disabled or the workspace is not trusted.": "Le coding style est désactivé ou l’espace de travail n’est pas approuvé.",
    "Bananabox Coding Style: checking {name}": "Coding Style Bananabox : vérification de {name}",
    "Bananabox Coding Style: no C source or header found in this project.": "Coding Style Bananabox : aucun source ou en-tête C trouvé dans ce projet.",
    "Bananabox Coding Style: {counts} in {files} files ({seconds} s)": "Coding Style Bananabox : {counts} dans {files} fichiers ({seconds} s)",
    "Bananabox Coding Style: no infractions in {files} files 🎉": "Coding Style Bananabox : aucune infraction dans {files} fichiers 🎉",
    "Show problems": "Afficher les problèmes",
    "No Makefile in the project folder.": "Aucun Makefile dans le dossier du projet.",
    "The Makefile could not be saved.": "Le Makefile n’a pas pu être enregistré.",
    "make re (with -g)": "make re (avec -g)",
    "make re exited with {code}": "make re s’est terminé avec le code {code}",
    "Valgrind command": "Commande Valgrind",
    "Program and arguments to run from the project folder. Leave empty to run ./NAME from the Makefile.": "Programme et arguments à lancer depuis le dossier du projet. Laissez vide pour lancer ./NAME du Makefile.",
    "Valgrind: {command}": "Valgrind : {command}",
    "Open a file of the project to check with valgrind.": "Ouvrez un fichier du projet pour vérifier avec valgrind.",
    "Edit command": "Modifier la commande",
    "Show output": "Afficher la sortie",
    "Valgrind is not installed on this machine (e.g. sudo apt install valgrind).": "Valgrind n’est pas installé sur cette machine (ex. sudo apt install valgrind).",
    "No program to run: the Makefile has no NAME. Set the command valgrind runs.": "Aucun programme à lancer : le Makefile n’a pas de NAME. Définissez la commande lancée par valgrind.",
    "Valgrind could not run \"{command}\"{detail}": "Valgrind n’a pas pu lancer \"{command}\"{detail}",
    "\"{command}\" crashed ({signal}). Check its arguments. {leaks} leak(s), {lost} lost.": "\"{command}\" a planté ({signal}). Vérifiez ses arguments. {leaks} fuite(s), {lost} perdus.",
    "Valgrind: {lost} lost{errors}{unlocated}.": "Valgrind : {lost} perdus{errors}{unlocated}.",
    ", {n} memory error(s)": ", {n} erreur(s) mémoire",
    "({n} without a line: build with -g)": "({n} sans ligne : compilez avec -g)",
    "Valgrind: no leak, no memory error.": "Valgrind : aucune fuite, aucune erreur mémoire.",
    "Bananabox Coding Style: no infractions found in this file.": "Coding Style Bananabox : aucune infraction dans ce fichier.",
    "Line {n}": "Ligne {n}",
    "Insert the Epitech Makefile header": "Insérer l’en-tête Epitech du Makefile",
    "Remove all trailing whitespace in this file": "Supprimer tous les espaces en fin de ligne de ce fichier",
    'Cannot find "{name}". Install epiclang or set "bananalens.compiler" to its full path.': 'Impossible de trouver "{name}". Installez epiclang ou définissez "bananalens.compiler" avec son chemin complet.',
    "Banana · {n} finding": "Banana · {n} résultat",
    "Banana · {n} findings": "Banana · {n} résultats",
};
