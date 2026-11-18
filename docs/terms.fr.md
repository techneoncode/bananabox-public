# Conditions d'utilisation et données collectées

Bananabox est une extension non officielle et open source (licence MIT), fournie telle quelle, sans garantie. Elle n'est pas affiliée à Epitech.

L'essentiel : Bananabox envoie très peu d'informations techniques à sa propre API, pour des **statistiques** et pour la **sécurité**. Aucun mot de passe, e-mail, projet, fichier ni donnée My ne quitte ta machine à cause de cela, et tu peux demander à tout moment la suppression de ce qui est stocké.

Tu dois accepter ces conditions à la première ouverture de la page de connexion, avant de pouvoir te connecter. **Rien sur toi n'est envoyé à l'API avant que tu acceptes** (seule la politique publique, décrite plus bas, est téléchargée).

## Ce qui est envoyé, et pourquoi

L'API tourne sur Cloudflare Workers et Cloudflare D1. Quand tu utilises Bananabox, à chaque lancement il envoie :

| Donnée | De quoi il s'agit |
| --- | --- |
| Nom de compte (`whoami`) | Le nom de ton compte utilisateur sur ton ordinateur : ce qu'affiche la commande `whoami` dans un terminal, par exemple `jdupont`. Ce n'est ni ton login Epitech, ni ton e-mail, ni ton vrai nom, même s'il peut y ressembler. |
| Identifiant d'installation | Un nombre aléatoire généré sur ta machine, sans lien avec toi. Le serveur n'en conserve que le SHA-256. |
| Version de l'extension | Par exemple `1.4.0`. Après une mise à jour, l'ancienne et la nouvelle version sont aussi envoyées une fois. |

Le serveur en déduit le nombre de lancements, la date du premier et du dernier lancement, et la date de chaque mise à jour.

**Pourquoi on en a besoin**

- **Statistiques.** Savoir combien de personnes utilisent l'extension, dans quelles promotions d'Epitech, et aussi combien de personnes extérieures à Epitech l'utilisent. Cela indique aussi quelles versions sont encore utilisées et quand abandonner les anciennes.
- **Sécurité.** Si une version malveillante était un jour publiée (on espère que non, et le projet GitHub est protégé contre cela), on saurait quels ordinateurs sont touchés et on pourrait agir vite. Le nom de compte permet aussi aux mainteneurs de restreindre un compte précis en cas d'abus grave, ce qui exige d'en connaître le nom.

C'est avant tout de la statistique et de la sécurité. On ne s'en sert pour rien d'autre, on ne le vend pas et on ne le partage pas.

## Ce qui est stocké

Exactement ceci, et rien de plus :

| Stocké | Contenu | Conservé |
| --- | --- | --- |
| Installation | SHA-256 de l'identifiant d'installation, nom de compte, version, nombre de lancements, premier et dernier lancement | 180 jours après le dernier lancement |
| Historique des mises à jour | SHA-256 de l'identifiant d'installation, ancienne et nouvelle version, date | 365 jours |
| Nonces | Une valeur aléatoire à usage unique qui empêche de rejouer une requête interceptée | 5 minutes |

Seuls les mainteneurs peuvent lire les noms de compte, via un point d'accès d'administration authentifié. Une tâche quotidienne supprime les données expirées.

**Ni stocké ni envoyé :** ton e-mail, ton nom, ton mot de passe, tes jetons Microsoft ou My, tes projets, fichiers, notes, ton code, ni ton adresse IP (comme toute requête web, l'appel atteint Cloudflare, qui traite des métadonnées réseau selon ses propres politiques ; l'API Bananabox ne la stocke pas).

## Politique distante

Chaque minute, l'extension télécharge la politique (`GET /v1/config`) : les deux interrupteurs de fonctionnalités, la version requise et les listes de noms de compte autorisés et bannis. C'est ce qui permet de désactiver une version défectueuse et de livrer les mises à jour. La comparaison entre ton nom de compte et ces listes se fait sur ta machine. Les listes sont publiques.

## Ton contrôle

- Tu peux lire le code : tout ce qui est décrit ici se trouve dans ce dépôt.
- Désactive l'envoi avec le réglage `epibox.anonymousStatistics`. L'extension demande alors à l'API de supprimer tout ce qui est stocké pour ton installation et oublie l'identifiant.
- Pour toute autre demande (accès, suppression), ouvre une issue sur https://github.com/techneoncode/bananabox-public.
- Si tu n'acceptes pas ces conditions, tu ne peux pas te connecter avec Bananabox.

## Modifications

Les modifications de ces conditions sont publiées dans ce dépôt avec la version qui les introduit. La version anglaise est [terms.md](terms.md).
