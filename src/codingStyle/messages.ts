import * as vscode from 'vscode';

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
export function styleMessage(message: string): string {
    const setting = vscode.workspace.getConfiguration?.('epibox')
        .get<string>('language') ?? 'auto';
    const fr = setting === 'fr'
        || (setting !== 'en'
            && (vscode.env?.language ?? '').toLowerCase().startsWith('fr'));
    return translateMessage(message, fr ? 'fr' : 'en');
}
