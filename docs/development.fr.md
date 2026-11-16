# Bananabox

Vos projets Epitech et votre coding style dans une seule extension VS Code : MyEpitech, calendrier, dépôts, sujets, grader, historique GitHub et lenses de diagnostics C/C++. L’interface reprend les couleurs, polices, icônes et états de votre thème VS Code. Les graphiques sont en SVG ; les sujets sont affichés dans une webview avec PDF.js.

## Démarrer

1. Installer les dépendances avec `npm install` (Node.js 22 recommandé pour les outils de développement).
2. Exécuter `npm run typecheck`, `npm test`, puis `npm run build`.
3. Ouvrir ce dossier dans VS Code et appuyer sur **F5**.
4. Ouvrir **Bananabox** dans la barre d’activité, puis **Se connecter avec Microsoft** : une fenêtre s’ouvre, vous vous connectez, elle se ferme toute seule.
   Alternative : **Sign In with Access Token**.
5. (Alternative) Coller l’`access_token` MyEpitech, avec ou sans préfixe `Bearer`. Un token Microsoft Entra est échangé via `/api/auth/token`.

### Connexion Microsoft (sans copier-coller)

Le bouton **Se connecter avec Microsoft** (ou `Bananabox: Sign In with Microsoft`) rejoue le flux de `my.epitech.eu` : *authorization code + PKCE* avec le client SPA public du site (`redirect_uri=https://my.epitech.eu`, seule redirection enregistrée). Le *device code flow* est impossible pour un client SPA (`AADSTS7000218` / `AADSTS9002326`).

Comme le code ne peut pas être renvoyé vers VS Code, Bananabox **lit la redirection lui-même** :

1. Bananabox ouvre une fenêtre de navigateur dédiée sur la page Microsoft (Chrome / Edge / Brave / Chromium via DevTools, **Firefox via WebDriver BiDi**) (SSO et MFA gérés par Microsoft ; vos identifiants ne passent jamais par l’extension).
2. Vous vous connectez dans cette fenêtre. Dès qu’elle arrive sur `my.epitech.eu/#code=…`, Bananabox lit l’adresse et **ferme la fenêtre** (Chromium : `--remote-debugging-pipe`, aucun port ; Firefox : WebSocket BiDi sur `127.0.0.1`, port local aléatoire, le temps de la connexion).
3. Bananabox échange le code (PKCE + `Origin: https://my.epitech.eu`), puis l’ID token via `POST /api/auth/token`.

Bananabox préfère Chrome/Edge/Brave/Chromium s’il en trouve, sinon Firefox. Avec Firefox, c’est une **instance séparée** (`--no-remote`, profil dédié) : vos onglets et votre profil ne sont jamais touchés. Sur Ubuntu, Firefox est un *snap* qui ne peut pas lire `~/.config` : le profil dédié est alors créé dans `~/snap/firefox/common/epibox-firefox-profile`.

La fenêtre a son **propre profil** (dossier de stockage global de l’extension) : les cookies Microsoft y sont conservés. Répondez **Oui** à « Rester connecté ? » : les connexions suivantes sont quasi instantanées, et Bananabox renouvelle la session **sans rien afficher** (`prompt=none` dans un navigateur invisible) quand le refresh token de 24 h est épuisé.

**Secours** : si aucun navigateur compatible n’est trouvé (ou si Firefox Flatpak : indiquez son exécutable dans `epibox.browserPath`, sinon collage) (ou si vous cliquez sur « La fenêtre ne s’ouvre pas ? »), Bananabox ouvre votre navigateur habituel et vous collez l’adresse de la page d’arrivée (`#code=…`). Le réglage `epibox.browserPath` permet d’indiquer un exécutable précis. Le token manuel reste disponible.

Les tokens sont stockés dans `SecretStorage`, jamais dans les paramètres ni dans la webview.

**Session « éternelle »** : à chaque expiration (ou 401, ou 5 min avant l'échéance), Bananabox renouvelle la session dans cet ordre :
1. `POST /api/auth/refresh` avec le refresh token **MyEpitech** (`{ "refresh_token": … }`, sans Authorization). Il est renouvelé à chaque appel, donc la session se prolonge indéfiniment tant qu'Bananabox l'utilise.
2. Sinon, le refresh token Microsoft (24 h), puis l'échange `POST /api/auth/token`.
3. Sinon, le navigateur invisible (`prompt=none`).

Un refresh token refusé (4xx) est supprimé ; une panne réseau le conserve pour la tentative suivante.

## Projets et dépôts

- Projets en cours et passés auxquels vous êtes inscrit, et projets à venir ; recherche et filtres par période.
- Fiche avec ouverture, mid, fermeture, inscription, groupe et liens MyEpitech/Hermes.
- Détection du projet à partir des remotes Git, puis du nom de dépôt si la correspondance est unique. Les dossiers multiples du workspace sont examinés.
- Clonage en SSH ou HTTPS, choix du dossier parent et du nom, puis ouverture dans la fenêtre courante, une nouvelle fenêtre ou ajout au workspace.
- Dans un dépôt reconnu, la barre latérale affiche directement le projet. La flèche de retour permet de consulter tous les projets.

## Grader

L’onglet Grader présente le quota, les exécutions, l’évolution du pourcentage de tests réussis et les résultats détaillés. Sélectionner une exécution dans le graphique ou l’historique affiche ses tests, traces, erreurs de compilation et informations de coding style. Les traces peuvent être filtrées et copiées.

**Lancer le grader évalue le dernier commit poussé sur le dépôt distant et consomme un jeton.** L’extension ne pousse pas vos modifications. Un double clic ne soumet pas deux requêtes. Le suivi s’arrête après dix minutes ; Actualiser permet de le reprendre. Le pourcentage affiché mesure les tests réussis, pas une note académique officielle intégrant toutes les pénalités.

## Sujets et limites vérifiées

Les deux HAR fournis confirment la connexion, la liste paginée des projets, les quotas, la soumission et les résultats du grader. Ils ne contiennent ni route de téléchargement de sujet, ni date officielle de mid, ni réponse aux filtres `past` / `upcoming`.

- Le mid est explicitement marqué **estimé** lorsque l’API ne le fournit pas.
- Les liens de sujet présents dans la liste des projets sont utilisés directement, y compris les pièces jointes PDF avec une URL de téléchargement signée. La route de détail du premier jet reste un secours expérimental, non confirmé par ces captures.
- L’onglet Sujet affiche le PDF dans VS Code. **Ouvrir en ligne** ouvre le lien du sujet, ou la fiche MyEpitech si aucun lien direct n’est connu. **Ouvrir sur l’ordinateur** ouvre un PDF local avec l’application associée ; pour un PDF téléchargé, un dialogue permet de choisir où l’enregistrer avant ouverture. Un PDF peut aussi être sélectionné depuis le disque.
- Les champs `repoLink`, `repositoryUrl` et `repoUrl` du projet ou de son inscription sont prioritaires. La fiche est consultée à l’ouverture et, si nécessaire, avant clonage ; les résultats existants du grader ne sont qu’une source de secours. Aucun lancement de grader n’est requis. Le dépôt du cursus n’est jamais utilisé comme dépôt de projet.
- Une capture supplémentaire de l’ouverture de la fiche puis du sujet est nécessaire pour valider la récupération automatique des PDF.

Aucun appel aux absences, au logtime, aux notifications ou aux autres données académiques n’est nécessaire au fonctionnement.

## Réglages

Chercher **Bananabox** dans les paramètres de VS Code : langue français/anglais, protocole de clonage, répertoire parent, ouverture automatique dans l’éditeur, intervalle du grader et barre d’état. Les couleurs proviennent du thème, sans palette imposée.

## Vérification et distribution

```sh
npm run typecheck
npm test
npm run package
```

La dernière commande produit un fichier `.vsix`, installable avec **Extensions: Install from VSIX…**. Les tests utilisent des réponses synthétiques et un extrait anonymisé des HAR ; ils n’envoient aucune requête au service Epitech et ne consomment aucun jeton. Une validation manuelle dans un Extension Development Host avec un compte réel reste nécessaire avant diffusion à grande échelle.

Les HAR bruts sont exclus de Git et du VSIX : ils peuvent contenir des identifiants de session. Ne pas les distribuer. Les sources et les tests sont également exclus du paquet.

## Explorer les commits du grader

Cliquer sur un identifiant de commit (résumé, historique, détail ou infobulle du graphique) propose **Ouvrir sur GitHub**, **Explorer les fichiers dans VS Code** ou **Copier l’identifiant**. L’explorateur apparaît dans **Explorateur → Bananabox · Diffs de commits** ; les dossiers se chargent à la demande et les fichiers texte s’ouvrent en lecture seule à la révision choisie. Aucun checkout n’est effectué.

Le résumé et le détail comparent le commit évalué au **HEAD du dépôt local correspondant** : identique, différent, ou comparaison indisponible. Les modifications enregistrées mais non commitées (y compris les fichiers non suivis) sont signalées séparément. Actualisation toutes les dix secondes, au retour dans VS Code et via Actualiser. Cet indicateur ne vérifie ni les changements non enregistrés dans l’éditeur ni le HEAD distant.

Si le commit n’est pas disponible localement, Bananabox utilise l’API GitHub avec la session GitHub autorisée dans VS Code. Le compte disponible apparaît dans le menu ; VS Code propose la connexion ou l’autorisation d’accès si nécessaire. Le compte du navigateur reste indépendant. Les sous-modules sont indiqués sans exploration ; les fichiers binaires et les fichiers de plus de 10 Mio renvoient vers GitHub. Git LFS affiche le pointeur enregistré dans Git.

Un clic sur un fichier dans **Bananabox · Diffs de commits** ouvre un diff : **version locale actuelle à gauche**, **version du commit à droite**. La gauche inclut les modifications non enregistrées des fichiers ouverts. Un fichier absent localement est représenté par un volet vide. Sans dépôt local correspondant, seul le fichier historique est ouvert avec un message explicatif. L’affichage côte à côte suit le réglage VS Code `diffEditor.renderSideBySide`.

## Coding style intégré (Bananabox 0.3)

Bananabox intègre le moteur de Banana Lens 1.3.0 : diagnostics epiclang, messages colorés sur les lignes, résumé CodeLens, navigation entre infractions, analyse du projet et corrections vérifiées. Ces fonctions sont disponibles sans connexion MyEpitech. Les commandes **Bananabox Coding Style** sont dans la palette, le menu contextuel C/C++ et le menu de la vue Bananabox.

Installez `epiclang` sur la machine où tourne l’extension (ou définissez `bananalens.compiler`). Les anciens réglages `bananalens.*`, couleurs et fichiers `.bananalens.json` restent compatibles. Les corrections sont désactivées par défaut ; choisissez le mode suggestion ou automatique avec **Bananabox Coding Style: Choose correction mode**. L’analyse nécessite un espace de travail approuvé. Les versions historiques ouvertes dans l’explorateur de commits restent en lecture seule et ne sont pas analysées comme des fichiers de travail.

Installez uniquement le VSIX Bananabox et désactivez l’ancienne extension Banana Lens si elle est encore installée pour éviter les diagnostics en double. La fusion nécessite VS Code 1.95 ou supérieur. Le moteur de coding style conserve sa licence MIT dans `licenses/Banana-Lens.txt`.

Tests du moteur intégré : `npm run test:coding-style`. `npm test` exécute les suites Bananabox et coding style ; `npm run package` produit un unique VSIX Bananabox.
