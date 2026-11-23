# Conditions d'utilisation et données collectées

Bananabox est une extension non officielle et open source (licence MIT), faite par des étudiants pour des étudiants, fournie telle quelle, sans garantie. Elle n'est pas affiliée à Epitech.

**L'essentiel, en une phrase :** on garde le strict minimum pour savoir qui utilise l'extension et pour la garder sûre, on ne vend rien, on ne partage rien, et tu peux tout faire supprimer quand tu veux.

On ne lit pas ton code, tes projets, tes fichiers, tes notes ni tes messages. Ton mot de passe, ton e-mail et tes jetons Microsoft ou My ne quittent jamais ton ordinateur. Tout le code de l'extension et de l'API est public dans ce dépôt : tu peux vérifier chaque ligne de ce qui est écrit ici.

Tu dois accepter ces conditions avant de te connecter avec Bananabox. Lire ce texte en entier n'est pas obligatoire pour accepter, mais on te le conseille : il est court. **Rien sur toi n'est envoyé avant que tu acceptes** (seule la politique publique, décrite plus bas, est téléchargée).

## Ce qui est envoyé, et pourquoi

L'API de Bananabox tourne sur Cloudflare Workers et Cloudflare D1. Voici tout ce qu'elle reçoit.

**À chaque lancement**

| Donnée | De quoi il s'agit |
| --- | --- |
| Identifiant d'installation | Un nombre aléatoire tiré sur ta machine, sans lien avec toi. Le serveur n'en garde que l'empreinte SHA-256. |
| Identifiant anonyme d'utilisateur | Une empreinte (SHA-256) calculée sur ta machine à partir de l'identifiant de VS Code et de l'UID de ton compte système. Elle ne contient ni ton nom ni ton nom de compte, et on ne peut pas remonter de l'empreinte jusqu'à eux. Elle sert seulement à reconnaître le même ordinateur d'un lancement à l'autre. |
| Version de l'extension | Par exemple `1.6.0`. Après une mise à jour, l'ancienne et la nouvelle version sont envoyées une fois. |

**Une fois connecté à My**, Bananabox ajoute ce que ton profil Epitech indique déjà :

| Donnée | Exemple |
| --- | --- |
| Prénom | `Zoé` |
| Initiale du nom de famille | `M` (jamais le nom complet) |
| Promotion et cursus | `2027`, `pge` |
| Campus | `Paris` |

Ton login, ton e-mail, ton nom de famille complet, tes notes, tes projets et tes crédits ne sont **jamais** envoyés.

**Pourquoi on en a besoin**

- **Des statistiques simples.** Savoir combien de personnes utilisent Bananabox, dans quelles promotions et sur quels campus, et quelles versions sont encore utilisées pour savoir quand abandonner les anciennes.
- **La sécurité de tous.** Si un jour une version défectueuse ou malveillante était publiée (le dépôt GitHub est protégé contre cela), on saurait qui est concerné et on pourrait réagir vite. En cas d'abus grave (par exemple un usage qui mettrait en danger l'accès de tout le monde à My), les mainteneurs peuvent restreindre l'accès d'une personne, d'une promotion ou d'un campus. Le prénom et l'initiale leur permettent de savoir qui ils restreignent, sans jamais avoir besoin de ton nom complet.

C'est tout. Ces données ne servent à rien d'autre : pas de publicité, pas de revente, pas de partage avec Epitech ni avec qui que ce soit, pas de profilage.

## Ce qui est stocké

Exactement ceci, et rien de plus :

| Stocké | Contenu | Conservé |
| --- | --- | --- |
| Installation | Empreinte de l'identifiant d'installation, identifiant anonyme d'utilisateur, prénom, initiale du nom, promotion, cursus, campus, version, nombre de lancements, premier et dernier lancement | 180 jours après le dernier lancement, puis supprimé automatiquement |
| Historique des mises à jour | Empreinte de l'identifiant d'installation, ancienne et nouvelle version, date | 365 jours |
| Nonces | Une valeur aléatoire à usage unique qui empêche de rejouer une requête interceptée | 5 minutes |

Les versions antérieures à 1.6.0 envoyaient le nom de ton compte système (`whoami`). Ce n'est plus le cas. Ce qui avait été reçu reste attaché à l'installation concernée et disparaît avec elle, au plus tard 180 jours après son dernier lancement.

Seuls les mainteneurs de Bananabox peuvent consulter ces données, depuis un tableau de bord protégé par un compte et un mot de passe. Chacune de leurs actions (ban, levée de ban, changement de politique) est enregistrée dans un journal. Une tâche quotidienne supprime les données expirées.

**Ni stocké ni envoyé :** ton nom de famille complet, ton login, ton e-mail, ton mot de passe, tes jetons Microsoft ou My, tes projets, fichiers, notes, ton code, ni ton adresse IP. Comme pour toute requête web, l'appel passe par Cloudflare, qui traite des métadonnées réseau selon ses propres politiques ; l'API Bananabox ne garde pas ton adresse IP.

## Politique publique et restrictions

Chaque minute, l'extension télécharge la politique publique (`GET /v1/config`) : les interrupteurs des fonctionnalités, la version requise et les restrictions en cours. C'est ce qui permet de désactiver une version défectueuse et de livrer les mises à jour.

Une restriction vise un identifiant anonyme d'utilisateur, une promotion ou un campus (ou, pour celles faites avant la version 1.6.0, un nom de compte système). La comparaison avec ta situation se fait **sur ton ordinateur**. La politique est publique : elle contient ces cibles, la raison donnée et le nom de l'administrateur qui a décidé, sauf s'il a choisi de le masquer. **Ton prénom n'y apparaît jamais.**

Si une restriction te concerne, Bananabox te le dit clairement : qui est visé, pourquoi, qui a décidé et depuis quand, et ce qui fonctionne encore. Tu peux faire appel sur Microsoft Teams.

## Ce que tu contrôles

- **Tout vérifier :** tout ce qui est décrit ici se trouve dans le code de ce dépôt.
- **Tout arrêter et tout supprimer :** désactive le réglage `bananabox.anonymousStatistics`. L'extension demande alors à l'API de supprimer tout ce qui est stocké pour ton installation, et oublie son identifiant.
- **Toute autre demande** (savoir ce qu'on a sur toi, faire supprimer quelque chose) : ouvre une issue sur https://github.com/techneoncode/bananabox-public, on te répondra.
- Si tu n'acceptes pas ces conditions, tu peux toujours désinstaller Bananabox, mais tu ne pourras pas te connecter avec.

## Modifications

Les modifications de ces conditions sont publiées dans ce dépôt avec la version qui les introduit. La version anglaise est [terms.md](terms.md).
