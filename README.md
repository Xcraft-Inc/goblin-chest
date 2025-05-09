# 📘 Documentation du module goblin-chest

## Aperçu

Le module `goblin-chest` est un système de stockage de fichiers avancé pour l'écosystème Xcraft. Il fournit une solution complète pour gérer le cycle de vie des fichiers avec des fonctionnalités de chiffrement, compression, versionnement et aliasing. Ce module agit comme un coffre-fort sécurisé pour les fichiers, permettant leur stockage, récupération et gestion efficace dans une application Xcraft.

## Structure du module

Le module s'articule autour de trois acteurs Elf principaux :

1. **Chest** - L'acteur principal qui orchestre le stockage et la récupération des fichiers
2. **ChestObject** - Représente un fichier individuel stocké dans le coffre avec ses métadonnées
3. **ChestAlias** - Permet de créer des références nommées vers des ChestObjects dans des espaces de noms spécifiques

Le module utilise un système de backend configurable pour le stockage physique des fichiers, avec une implémentation par défaut basée sur le système de fichiers (`fs`).

## Fonctionnement global

### Stockage et récupération

Lorsqu'un fichier est fourni au coffre via la méthode `supply` :

1. Le fichier est temporairement stocké
2. Un hash SHA-256 est calculé pour identifier de manière unique le fichier
3. Le fichier est déplacé vers un emplacement permanent basé sur son hash
4. Un objet `ChestObject` est créé dans la base de données pour représenter le fichier
5. Optionnellement, un alias peut être créé pour référencer ce fichier de manière plus conviviale

La récupération se fait via la méthode `retrieve` qui utilise l'ID du `ChestObject` pour localiser et retourner le fichier.

### Gestion du cycle de vie

Le module gère automatiquement le cycle de vie des fichiers :

- Les fichiers peuvent être marqués comme "trashed" (mis à la corbeille)
- Les fichiers orphelins (non référencés) sont automatiquement collectés selon une planification
- Les fichiers peuvent être "unlinked" (dissociés), ce qui signifie que l'entrée dans la base de données existe mais que le fichier physique peut être supprimé

### Chiffrement et compression

Le module offre des capacités de sécurité avancées :

- Chiffrement AES-256-CBC par défaut
- Compression GZIP par défaut
- Utilisation de clés publiques/privées pour le chiffrement asymétrique

### Synchronisation client-serveur

Un mécanisme intelligent assure la synchronisation des fichiers entre clients et serveur :

- Si un client demande un fichier non disponible localement, il le demande au serveur
- Si le serveur ne trouve pas un fichier, il diffuse une demande à tous les clients connectés
- Les fichiers manquants sont automatiquement détectés et récupérés via un système de vérification périodique

## Exemples d'utilisation

### Stocker un fichier dans le coffre

```javascript
const {Chest} = require('goblin-chest/lib/chest.js');

// Dans une méthode d'un acteur Elf
async storeFile(filePath) {
  const chest = new Chest(this);

  // Stocker le fichier dans le coffre
  const chestObjectId = await chest.supply(
    filePath,
    'myFileName'
  );

  return chestObjectId;
}

// Dans une méthode d'un acteur Elf
async storeFileFromStream(filePath) {
  const chest = new Chest(this);

  // Créer un stream à partir du fichier
  const fs = require('fs');
  const xcraftStream = fs.createReadStream(filePath);

  // Stocker le fichier dans le coffre avec un alias
  const chestObjectId = await chest.supply(
    xcraftStream,
    path.basename(filePath),
    null,
    null,
    null,
    'documents',  // namespace
    'contract'    // alias
  );

  return chestObjectId;
}
```

### Récupérer un fichier du coffre

```javascript
const {Chest} = require('goblin-chest/lib/chest.js');

// Dans une méthode d'un acteur Elf
async retrieveFile(chestObjectId, outputPath) {
  const chest = new Chest(this);

  // Récupérer le fichier du coffre et le sauvegarder
  await chest.saveAsTry(chestObjectId, outputPath);
}
```

### Créer un alias pour un fichier existant

```javascript
const {ChestObject} = require('goblin-chest/lib/chestObject.js');

// Dans une méthode d'un acteur Elf
async createAlias(chestObjectId, namespace, aliasName) {
  const feedId = await this.newQuestFeed();

  const object = await new ChestObject(this).create(chestObjectId, feedId);
  const aliasId = await object.setAlias(namespace, aliasName);

  return aliasId;
}
```

### Rechercher des fichiers par namespace

```javascript
const {Chest} = require('goblin-chest/lib/chest.js');

// Dans une méthode d'un acteur Elf
async listDocuments(namespace, depth = 1) {
  const chest = new Chest(this);

  // Récupérer tous les alias dans un namespace spécifique
  const aliasGroups = await chest.getAliasIdsFromNamespace(namespace, depth);

  // Traiter les résultats
  return aliasGroups.map(group => {
    // Le premier élément de chaque groupe est la version la plus récente
    return group[0];
  });
}
```

## Interactions avec d'autres modules

- [**goblin-chronomancer**][1] : Utilisé pour planifier des tâches périodiques comme la vérification des fichiers manquants et la collecte des fichiers orphelins
- [**xcraft-core-goblin**][2] : Fournit l'infrastructure Elf pour les acteurs et la gestion des états
- [**xcraft-core-stones**][3] : Utilisé pour la définition des types de données et la validation
- [**xcraft-core-utils**][4] : Fournit des utilitaires pour les fichiers, les verrous et les checksums
- [**xcraft-core-etc**][5] : Gère la configuration du module

## Configuration avancée

- **backend** : Le backend à utiliser pour le stockage (par défaut : `fs`)
- **fs.location** : L'emplacement pour stocker les fichiers
- **fs.maxSize** : Taille maximale pour le stockage (0 = pas de limite)
- **fs.cipher** : Algorithme de chiffrement par défaut (aes-256-cbc)
- **fs.compress** : Algorithme de compression par défaut (gzip)
- **collect.orphans.maxSize** : Taille maximale des orphelins à conserver
- **chronomancer.missing.time** : Planification CRON pour la vérification des fichiers manquants
- **chronomancer.collect.time** : Planification CRON pour la collecte des fichiers à la corbeille

## Détails des sources

### `chest.js`

Ce fichier définit l'acteur principal `Chest` qui orchestre toutes les opérations de stockage et de récupération. Il initialise le backend approprié et expose les méthodes principales comme `supply`, `retrieve`, `trash`, etc.

L'acteur `Chest` est un singleton qui gère :

- L'initialisation du backend de stockage configuré
- La synchronisation des fichiers entre clients et serveur
- La gestion des fichiers orphelins via des tâches planifiées
- La vérification périodique des fichiers manquants

Les méthodes principales incluent :

- `supply` : Stocke un fichier dans le coffre
- `retrieve` : Récupère un fichier du coffre
- `location` et `locationTry` : Obtient l'emplacement physique d'un fichier
- `trash` et `unlink` : Gère le cycle de vie des fichiers
- `getAliasIdsFromNamespace` : Recherche des alias par namespace

### `chestObject.js`

Ce fichier définit l'acteur `ChestObject` qui représente un fichier stocké dans le coffre. Il gère les métadonnées du fichier et son cycle de vie.

L'état d'un `ChestObject` comprend :

- `id` : ID unique basé sur le hash du fichier
- `name` : Nom du fichier
- `ext` : Extension du fichier (déduite du nom ou du type MIME)
- `size` : Taille du fichier en octets
- `mime` et `charset` : Type MIME et jeu de caractères
- `encryption` : Informations sur le chiffrement (si utilisé)
- `link` : État de liaison ('linked' ou 'unlinked')
- `generation` : Numéro de version pour le versionnement
- `metadata` : Métadonnées optionnelles (titre, auteurs, etc.)

### `chestAlias.js`

Ce fichier définit l'acteur `ChestAlias` qui permet de référencer un `ChestObject` via un alias nommé dans un namespace. Cela permet d'avoir des noms conviviaux et organisés pour les fichiers.

L'état d'un `ChestAlias` comprend :

- `id` : ID unique au format `chestAlias@<namespace>@<chestObjectId>`
- `name` : Nom de l'alias
- `meta.status` : État de l'alias ('published' ou 'trashed')

### `backend/fs.js`

Ce fichier implémente le backend de stockage basé sur le système de fichiers. Il gère :

- Le stockage physique des fichiers dans une structure organisée
- Le chiffrement et le déchiffrement des fichiers
- La compression et la décompression
- La gestion de l'espace de stockage avec des limites configurables

Le backend utilise une structure de répertoires basée sur les deux premiers caractères du hash SHA-256 des fichiers pour un accès efficace. Il implémente également un système de rotation des fichiers basé sur leur date d'accès pour respecter les limites de taille configurées.

_Cette documentation a été mise à jour automatiquement._

[1]: https://github.com/Xcraft-Inc/goblin-chronomancer
[2]: https://github.com/Xcraft-Inc/xcraft-core-goblin
[3]: https://github.com/Xcraft-Inc/xcraft-core-stones
[4]: https://github.com/Xcraft-Inc/xcraft-core-utils
[5]: https://github.com/Xcraft-Inc/xcraft-core-etc