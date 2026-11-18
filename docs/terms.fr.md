# Conditions d'utilisation et données collectées

Bananabox est une extension open source non officielle (licence MIT), fournie en l'état, sans garantie. Elle n'est pas affiliée à Epitech.

## Ce que l'extension envoie à l'API Bananabox

L'API tourne sur Cloudflare Workers et Cloudflare D1.

**Politique distante (toujours).** Chaque minute, l'extension télécharge la politique (`GET /v1/config`) : les deux interrupteurs de fonctionnalités, la version requise et les listes de noms de compte bannis et autorisés. Cela permet de désactiver une version défectueuse et de livrer les mises à jour. La comparaison entre ton nom de compte système et ces listes se fait sur ta machine. **Ton nom de compte n'est jamais envoyé.**

**Statistiques d'utilisation anonymes (optionnelles, activées par défaut).** À chaque lancement, l'extension envoie :

- un identifiant d'installation aléatoire, généré sur ta machine, sans lien avec ton compte, ton e-mail ou ta machine. Le serveur n'en conserve que le SHA-256 ;
- la version de l'extension ;
- au premier lancement après une mise à jour, l'ancienne et la nouvelle version.

Le serveur en déduit le nombre de lancements, la date du premier et du dernier lancement de l'installation, et la date de chaque mise à jour. **Aucun nom, e-mail, nom de compte, projet, fichier ni donnée MyEpitech n'est envoyé**, et rien n'est envoyé quand la politique refuse ton compte.

Finalité : compter les installations actives, savoir quelles versions sont encore utilisées et décider quand abandonner les anciennes.

**Nonces à usage unique.** Chaque écriture de statistiques demande d'abord à l'API un nonce aléatoire (valable 5 minutes, utilisable une fois). Il empêche de rejouer une requête interceptée et d'altérer les compteurs d'une autre installation, ce qui exigerait aussi son identifiant secret.

**Métadonnées réseau.** Comme toute requête web, ces appels exposent ton adresse IP à Cloudflare. L'API Bananabox ne la stocke pas. Le traitement par Cloudflare relève de ses propres politiques.

## Information, consentement et contrôle

- Après une mise à jour qui ajoute les statistiques, l'extension affiche un message une seule fois et **n'envoie rien avant le lancement suivant**.
- Désactive-les avec le réglage `epibox.anonymousStatistics` (ou le bouton **Désactiver** du message). L'extension demande alors à l'API de supprimer tout ce qui est stocké pour l'installation et oublie l'identifiant.
- L'identifiant étant aléatoire et secret, personne, mainteneurs compris, ne peut relier les données à une personne. L'accès et la suppression passent donc par le réglage ci-dessus. Pour toute autre demande, ouvre une issue sur https://github.com/techneoncode/bananabox-public.

## Conservation

| Donnée | Durée |
| --- | --- |
| Installation (ID haché, version, lancements, premier et dernier lancement) | 180 jours après le dernier lancement |
| Historique des mises à jour (ID haché, versions, date) | 365 jours |
| Nonces | 5 minutes |

Une tâche quotidienne supprime les données expirées.

## Bannissements

Les mainteneurs peuvent restreindre des fonctionnalités pour les noms de compte listés dans la politique. Cette liste est lisible publiquement via `GET /v1/config`.

## Modifications

Les changements de ces conditions sont publiés dans ce dépôt avec la version qui les introduit. Version anglaise : [terms.md](terms.md).
