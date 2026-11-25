# Bananabox pour CLion

Le plugin reprend le moteur TypeScript, les écrans HTML/CSS, les traductions et les règles métier de l’extension VS Code. Une couche Java relie ces fonctions aux fenêtres, documents et diagnostics de CLion. Il ne nécessite pas VS Code.

## Installation

Prérequis : **CLion 2026.3** (build 263), son JetBrains Runtime avec JCEF, **Node.js 20+**, et **epiclang** pour le coding style. Le plugin est compilé contre la branche 263 et s’installe sur les versions 263.x.

1. Télécharger `bananabox-clion-<version>.zip` depuis la page de la release [techneoncode/bananabox-public](https://github.com/techneoncode/bananabox-public/releases) (même numéro de version que l’extension VS Code).
2. Dans CLion, **Settings → Plugins → ⚙ → Install Plugin from Disk**, puis choisir le ZIP. Redémarrer CLion.
3. Ouvrir un projet et afficher **View → Tool Windows → Bananabox**.
4. Se connecter depuis l’interface MyEpitech. Le coding style fonctionne aussi sans connexion.
5. Si nécessaire, choisir Node.js dans **Settings → Bananabox** et epiclang dans **Tools → Bananabox → Locate the epiclang executable**.

Les jetons sont conservés dans **JetBrains Password Safe**. L’analyse, les commandes locales et les corrections nécessitent un projet approuvé par CLion.

## Mises à jour

CLion ne peut pas installer un fichier VSIX. Quand la version requise par Bananabox est plus récente que celle installée, le plugin affiche une notification avec un bouton **Télécharger**. Ce bouton ouvre le ZIP CLion de la même version (`clion_latest` de la configuration distante) ou, à défaut, la page de la release. Installer ensuite le ZIP comme ci-dessus, puis redémarrer CLion. Les anciennes versions sont désactivées tant que la mise à jour n’est pas faite.

## Fidélité du portage

| Fonction | Prise en charge dans CLion |
| --- | --- |
| Application latérale (projets, agenda, grader) | Fenêtre d’outils Bananabox, avec les écrans partagés |
| Pages projet | Onglets de l’éditeur, un onglet par projet |
| Agenda et échéances | Écrans partagés |
| Projets MyEpitech et détection du dépôt | Services et interface partagés |
| Connexion Microsoft, renouvellement, connexion par jeton | Navigateur externe ; Password Safe pour les secrets |
| Grader, jetons, résultats, logs, comparaisons et historique | Services et écrans partagés ; confirmations natives |
| Sujet PDF, ressources et téléchargement | Lecteur PDF.js existant ; dialogues CLion |
| Rappel de soutenance | Onglet de l’éditeur ; le retour au premier plan lors d’un changement de terminal n’existe pas dans CLion |
| Préparation du rendu, compilation, tests, revue, commit et push | Parcours et contrôles existants ; écritures Git après les confirmations prévues |
| Exploration d’un commit | Arbre dans la fenêtre Bananabox ; clic sur un fichier pour ouvrir sa version historique en lecture seule ; clic droit pour comparer au fichier de travail |
| Révision GitHub absente localement | Récupération avec les accès Git/SSH existants ; cache temporaire si aucun clone n’est ouvert ; compte GitHub de CLion en repli pour l’API |
| Analyse epiclang à l’ouverture, pendant la saisie, à la sauvegarde et du projet entier | Moteur et règles partagés ; diagnostics dans Problems et dans l’éditeur |
| Messages en bout de ligne, couleurs et résumé du fichier | Inlays et soulignements JetBrains ; actions du résumé sur une ligne au-dessus du code |
| Corrections désactivées, suggérées ou automatiques | Moteur et validation epiclang partagés ; aperçu dans le comparateur ; application annulable |
| `.bananalens.json`, `bananalens.json`, `.bananabox.json` | Formats existants conservés |
| Flags de compilation | Makefiles, `compile_commands.json`, `build/` et profils `cmake-build-*` |
| Paramètres `bananabox.*` et `bananalens.*` | Mêmes clés ; valeurs utilisateur dans Settings et valeurs projet dans le bouton Project settings |

### Ce qui ne fonctionne pas, ou autrement

- **Tableau de bord administrateur** : non proposé dans CLion. Le reste de l’application fonctionne normalement.
- **Désinstallation depuis Bananabox** : CLion ne peut pas retirer son propre plugin. Le message indique de passer par **Settings → Plugins**.
- **Rechargement de la fenêtre** : l’action « Reload » de VS Code redémarre le moteur Bananabox, pas CLion.
- **Terminal** : l’API terminal de VS Code n’est pas disponible ; les fonctions qui réagissent au terminal sont inactives.
- L’ajout d’un dépôt à un workspace VS Code ouvre une autre fenêtre CLion.
- Les sessions GitHub VS Code ne sont pas transférées. Bananabox réutilise les comptes GitHub de CLion, avec sélection mémorisée par projet. Pour ajouter un compte, **Tools → Bananabox → Sign in to GitHub** ouvre la connexion officielle JetBrains par navigateur. Le plugin GitHub fourni avec CLion doit être activé.
- Les corrections automatiques sont calculées après la notification de sauvegarde CLion, puis appliquées et sauvegardées si le document correspond toujours exactement à la version analysée. Une modification intervenue entre-temps annule l’application.
- Les raccourcis propres à VS Code ne sont pas tous imposés au keymap CLion. Les commandes sont disponibles dans **Tools → Bananabox** et dans **Find Action** ; `Ctrl+Alt+Enter` accepte les corrections suggérées. Les autres raccourcis peuvent être affectés dans Settings → Keymap.
- `.vscode/settings.json` n’est pas importé automatiquement. Les mêmes clés peuvent être copiées dans les paramètres Bananabox de CLion.
- Les couleurs et les tailles suivent le thème JetBrains. Le placement des inlays utilise les possibilités de CLion et peut différer de quelques pixels.
- Le moteur tourne sur la machine de l’IDE. Les toolchains distantes, WSL et les hôtes de développement distants nécessitent une validation dédiée.

Les parcours authentifiés MyEpitech et GitHub doivent être vérifiés avec un compte réel. Les tests automatisés n’envoient pas de rendu et ne consomment pas de jeton grader. Le test de fumée graphique (`smoke.py`) n’a pas été mené à son terme sur CLion 2026.3 : le plugin se charge et ouvre le projet, mais le rapport de fin n’a pas été produit dans le délai.

## Architecture

- `clion/host/` : processus Node qui exécute `src/extension.ts` tel quel. `clion/host/vscode.ts` implémente l’API `vscode` utilisée par le code partagé, en la traduisant en messages JSON vers Java. Aucune copie du code `src/` n’est faite.
- `clion/src/main/java/` : plugin IntelliJ (fenêtre d’outils, onglets, diagnostics, paramètres, GitHub, Password Safe).
- `clion/scripts/` : `build.mjs` (bundles et métadonnées), `package.py` (JAR et ZIP sans Gradle), `smoke.py` et `test-json.py`.

## Compilation et tests

Depuis la racine du dépôt :

```bash
npm ci
npm run build
CLION_HOME=/chemin/vers/clion npm run clion:build
npm run clion:typecheck
npm run clion:test
npm test
```

`clion:build` produit `clion/build/bananabox-clion-<version>.zip`, où `<version>` est la version de `package.json`. `CLION_HOME` désigne une installation CLion comprenant son SDK et son JBR. Sous macOS, utiliser le dossier `CLion.app/Contents`. Sous Linux, `/snap/clion/current` est utilisé par défaut. La compilation utilise `javac` du JBR et Python 3 pour créer le JAR et le ZIP ; aucun Gradle ni téléchargement d’IDE n’est nécessaire.

Vérification du transport JSON Java sans navigateur : après `npm run clion:build`, exécuter `python3 clion/scripts/test-json.py`.

Test de fumée graphique : `CLION_HOME=/chemin/vers/clion python3 clion/scripts/smoke.py`. Il lance une CLion réelle dans un profil jetable, avec une session graphique et epiclang installés. Il n’installe rien dans l’IDE de l’utilisateur.
