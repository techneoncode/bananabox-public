# Préparer un rendu avec Bananabox

Ouvre ton dépôt local, connecte-toi et ouvre l’onglet Grader du projet. Clique sur **Préparer le rendu** : aucune configuration Bananabox n’est nécessaire pour les projets reconnus.

Les panneaux se replient en cliquant sur leur titre ou leur chevron, et au clavier avec Entrée ou Espace. Leur état est mémorisé par projet dans la vue, y compris après sa réouverture. La comparaison et le coding style démarrent repliés pour garder les actions principales accessibles. Le bilan et la reproduction peuvent également être repliés. **Project Activities** est repliable. **Local coding style / Check the project** apparaît juste dessous, avant les onglets : la vérification reste accessible depuis toutes les vues du projet.

Le bloc **Grader** regroupe les tokens, le dernier score, l’état du dernier essai, puis **Essais et détails**. Une petite courbe d’évolution du score prend toute la largeur du bloc de statistiques, sous les colonnes tokens, dernier score et dernier essai. Survole un point pour voir son score, sa date et son commit ; clique dessus pour sélectionner cet essai. Un sélecteur compact et les flèches précédent/suivant permettent de parcourir l’historique sans afficher une longue liste séparée. Le rapport sélectionné apparaît juste dessous et le repère sur la courbe suit la sélection. Plusieurs tâches restent repliées au départ ; clique sur une tâche pour lire ses traces. Une recherche ouvre les tâches correspondantes. L’ensemble essais/détails peut être replié à l’intérieur du bloc.

À côté du bouton de lancement, **Dernier commit connu du Grader** affiche les sept premiers caractères du commit communiqué par l’API MyEpitech (`lastDelivery.commit`), par exemple `7bce58d`, et sa branche. La sélection du commit appartient au Grader : cet affichage ne nécessite aucune connexion GitHub dans VS Code. Le bouton d’actualisation interroge la même API. Chaque résultat conserve le commit effectivement évalué (`properties.commit`). Si l’API ne communique aucune livraison, aucun commit n’est déduit de l’historique.

Le parcours sauvegarde les fichiers, analyse le coding style avec BananaLens, compile et lance les tests locaux détectés. Il propose ensuite de relire les changements, de choisir les fichiers du commit, de saisir son message, puis de pousser la branche. La dernière confirmation affiche les tokens et les vérifications encore inconnues avant d’envoyer au grader. Si la branche est déjà propre et poussée, les étapes inutiles sont sautées.

Un échec local met le parcours en pause. Corrige le code puis clique sur **Reprendre le rendu** : les vérifications sont relancées. Pour les erreurs de style fatal/major, tu peux ouvrir les diagnostics et corriger, ou ignorer explicitement les erreurs en cas de faux positif. Modifier le code rend le bilan précédent périmé. **Vérifier maintenant** permet de vérifier sans faire de commit, de push ou d’envoi au grader.

Sous **Fonctions interdites**, saisis un nom comme `write`, puis valide avec **Ajouter** ou Entrée. Tu peux également coller `write, printf` ou des noms séparés par des espaces. Chaque fonction ajoutée possède une croix pour la retirer. La liste est mémorisée dans le stockage local de VS Code, par compte et projet : aucun `.bananabox.json` n’est créé. Relance **Vérifier maintenant** pour appliquer les règles. Les fonctions connues de la configuration ou du rapport restent prises en compte en plus de tes ajouts.

**Commité et poussé** est rouge quand des fichiers attendent un commit, des commits attendent un push ou la branche n’a pas encore de suivi distant. Par exemple, « 8 fichiers à commiter · 0 commits à pousser » signifie que tes commits existants sont poussés, mais que tes huit modifications locales ne sont pas encore dans ces commits. Le grader évalue le commit poussé, donc il ne voit pas encore ces modifications. **Préparer le rendu** accompagne leur relecture, leur commit et leur push.

## Ce qui est détecté

- Un Makefile à la racine pilote la compilation du projet. Sans Makefile racine, les dossiers indépendants contenant un Makefile sont compilés séparément avec `make -C dossier` : pratique pour les projets organisés par tâches.
- Les cibles `tests_run`, `test_run`, `test`, `tests` et `check` sont reconnues. Une cible de test à la racine prend la priorité ; sinon les cibles des sous-dossiers sont utilisées.
- Sans Makefile, les scripts `build` et `test` du `package.json` sont reconnus. Les scripts locaux `tests/run_tests.sh`, `tests/test.sh`, `test.sh` et `run_tests.sh` peuvent également servir de tests.
- Les sources déclarées simplement dans le Makefile sont vérifiées, ainsi que les fonctions interdites connues du dernier rapport du grader.
- Les noms de dossier et les numéros comme `task01` associent les tâches du grader aux tâches locales. Les commandes simples visibles dans les traces peuvent préciser une cible Makefile ou l’exécution du binaire déclaré par le projet.

Les commandes retenues sont visibles dans le bilan. Les Makefiles sont lus statiquement pendant la détection ; les commandes ne sont lancées qu’au démarrage d’une vérification ou d’une reproduction, dans un espace de travail approuvé. Les commandes complexes des traces nécessitent une recette locale explicite.

Les binaires et objets générés connus qui ne sont pas suivis par Git ne sont pas proposés automatiquement pour le commit et ne rendent pas le bilan périmé. Les fichiers déjà suivis restent des changements à relire. Bananabox ne modifie pas ton `.gitignore`.

## Comparer et reproduire

La comparaison suit automatiquement les deux derniers essais, même après l’arrivée d’un nouveau résultat. Les deux listes **Avant** et **Après**, directement visibles à l’ouverture de la comparaison, permettent de choisir librement deux essais de l’historique ; **Suivre les derniers essais** réactive le suivi automatique. Tu vois les tâches corrigées, les régressions, les erreurs persistantes, les traces et le diff des commits. Le mini-historique reprend les résultats disponibles pour chaque tâche. Le score avant/après et son écart en points sont affichés indépendamment du filtre. Les compteurs utilisent les résultats chiffrés du détail, complétés par les résultats par tâche de l’historique si nécessaire ; ils rapprochent aussi les libellés numérotés et les noms de tâches simples quand ils sont uniques. Une progression du taux de réussite reste détectée si le nombre de tests change. Sans résultats de tâches comparables, les compteurs affichent « — » avec une explication plutôt que des zéros trompeurs.

L’**Analyse automatique des traces** reconnaît les erreurs de compilation et de liaison, les crashs, les diagnostics mémoire, les timeouts, les assertions, les sorties incorrectes, le style et les fonctions interdites. Elle distingue les constats nouveaux, persistants et non retrouvés dans le nouvel essai. Elle indique les tâches concernées et la première étape explicitement en échec, et conserve un extrait pour vérifier chaque constat. Les emplacements source ouvrent le fichier local correspondant ; les chemins du conteneur du grader sont rapprochés des chemins locaux, avec le dossier de tâche quand il est connu. Un chemin ambigu n’ouvre pas un fichier au hasard.

Quand les logs nomment explicitement les tests (notamment Criterion, pytest et TAP), leurs passages de l’échec à la réussite ou l’inverse sont comparés. Si le grader ne fournit que des scores par tâche, la comparaison reste à ce niveau. Une erreur absente du nouvel extrait est seulement « non retrouvée » : elle peut avoir disparu parce que le test n’a pas été exécuté. La détection fonctionne localement sans service supplémentaire ; elle reconnaît des motifs dans les logs et n’invente pas les entrées cachées. Les logs volumineux sont analysés avec des limites et les analyses sont réutilisées pendant les rafraîchissements de l’interface.

Sur une tâche en échec, **Reproduire localement** utilise en priorité une recette enregistrée, puis une invocation du binaire reconnue dans les traces, une cible de tests ou un script local. Le panneau montre la commande, les sorties et le code retour. Sans commande de test connue, il vérifie la compilation de la tâche et l’indique clairement. Les entrées cachées et les sorties attendues absentes du rapport ne peuvent pas être devinées.

## Ajuster uniquement si nécessaire

**Ajuster la détection** ouvre un fichier `.bananabox.json` dans ton projet. Tu peux préciser un cas particulier ; les autres commandes continuent d’être détectées automatiquement. Les tableaux `command` contiennent le programme puis ses arguments, sans syntaxe shell. `cwd` est relatif au dépôt et le délai est compris entre 1 et 300 secondes.

Exemple avec une commande de tests spécifique et une recette associée au nom exact d’une tâche du grader :

```json
{
  "version": 1,
  "tests": {
    "command": ["make", "tests_run"],
    "timeoutSeconds": 120
  },
  "requiredFiles": ["task01/Makefile", "task01/main.c"],
  "forbiddenFunctions": ["printf"],
  "recipes": {
    "01 - task01": {
      "build": { "command": ["make", "-C", "task01"] },
      "command": ["./task01", "hello"],
      "cwd": "task01",
      "stdin": "",
      "expectedStdout": "hello\n",
      "expectedExitCode": 0,
      "timeoutSeconds": 30
    }
  }
}
```

Le nom du binaire dans cet exemple est `task01`. Adapte-le à ton projet. Les sorties attendues sont facultatives ; lorsqu’elles sont renseignées, Bananabox compare la sortie standard et le code retour. Supprimer les champs `build` et `tests` réactive leur détection automatique. Supprimer le fichier rétablit tous les réglages automatiques.

Un bilan vert valide uniquement les contrôles disponibles localement. Le grader reste nécessaire pour les tests cachés ; chaque envoi demande une confirmation explicite dans le parcours guidé.
