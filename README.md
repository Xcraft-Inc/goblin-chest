# 📘 Documentation du module goblin-chest

## Aperçu

Le module `goblin-chest` est un système de stockage de fichiers avancé pour l'écosystème Xcraft. Il fournit une solution complète pour gérer le cycle de vie des fichiers avec des fonctionnalités de chiffrement, compression, versionnement et aliasing. Ce module agit comme un coffre-fort sécurisé pour les fichiers, permettant leur stockage, récupération et gestion efficace dans une application Xcraft.

## Structure du module

Le module s'articule autour de trois acteurs Elf principaux :

1. **Chest** - L'acteur principal singleton qui orchestre le stockage et la récupération des fichiers
2. **ChestObject** - Représente un fichier individuel stocké dans le coffre avec ses métadonnées
3. **ChestAlias** - Permet de créer des références nommées vers des ChestObjects dans des espaces de noms spécifiques

Le module utilise un système de backend configurable pour le stockage physique des fichiers, avec une implémentation par défaut basée sur le système de fichiers (`fs`).

## Fonctionnement global

### Stockage et récupération

Lorsqu'un fichier est fourni au coffre via la méthode `supply` :

1. Le fichier est temporairement stocké via un stream d'écriture
2. Un hash SHA-256 est calculé pour identifier de manière unique le fichier
3. Le fichier est déplacé vers un emplacement permanent basé sur son hash (structure de répertoires avec les 2 premiers caractères du hash)
4. Un objet `ChestObject` est créé dans la base de données pour représenter le fichier avec ses métadonnées
5. Optionnellement, un alias peut être créé pour référencer ce fichier de manière plus conviviale

La récupération se fait via la méthode `retrieve` qui utilise l'ID du `ChestObject` pour localiser et retourner le fichier sous forme de stream.

### Gestion du cycle de vie

Le module gère automatiquement le cycle de vie des fichiers :

- Les fichiers peuvent être marqués comme "trashed" (mis à la corbeille)
- Les fichiers orphelins (non référencés) sont automatiquement collectés selon une planification CRON
- Les fichiers peuvent être "unlinked" (dissociés), ce qui signifie que l'entrée dans la base de données existe mais que le fichier physique peut être supprimé
- Un système de génération permet de gérer les versions successives des fichiers

### Chiffrement et compression

Le module offre des capacités de sécurité avancées :

- Chiffrement AES-256-CBC par défaut avec clés générées aléatoirement
- Compression GZIP par défaut
- Utilisation de clés publiques/privées pour le chiffrement asymétrique des clés symétriques
- Les clés symétriques et IV sont chiffrées avec la clé publique fournie

### Synchronisation client-serveur

Un mécanisme intelligent assure la synchronisation des fichiers entre clients et serveur :

- Si un client demande un fichier non disponible localement, il le demande au serveur via RPC
- Si le serveur ne trouve pas un fichier, il diffuse un événement `missing-file-needed` à tous les clients connectés
- Les clients qui possèdent le fichier le fournissent automatiquement au serveur
- Les fichiers manquants sont automatiquement détectés et récupérés via un système de vérification périodique (CRON)

## Exemples d'utilisation

### Stocker un fichier dans le coffre

```javascript
// Dans une méthode d'un acteur Elf
async storeFile(xcraftStream, fileName) {
  const chest = new Chest(this);

  // Stocker le fichier dans le coffre
  const chestObjectId = await chest.supply(
    xcraftStream,
    fileName
  );

  return chestObjectId;
}
```

### Stocker un fichier avec alias

```javascript
// Dans une méthode d'un acteur Elf
async storeFileWithAlias(xcraftStream, fileName, namespace, alias) {
  const chest = new Chest(this);

  // Stocker le fichier dans le coffre avec un alias
  const chestAliasId = await chest.supply(
    xcraftStream,
    fileName,
    null,        // streamId
    null,        // chestObjectId
    null,        // cert
    namespace,   // namespace
    alias        // alias
  );

  return chestAliasId;
}
```

### Récupérer un fichier du coffre

```javascript
// Dans une méthode d'un acteur Elf
async retrieveFile(chestObjectId, outputPath) {
  const chest = new Chest(this);

  // Récupérer le fichier du coffre et le sauvegarder
  await chest.saveAsTry(chestObjectId, outputPath);
}
```

### Rechercher des fichiers par namespace

```javascript
// Dans une méthode d'un acteur Elf
async listDocuments(namespace, depth = 1) {
  const chest = new Chest(this);

  // Récupérer tous les alias dans un namespace spécifique
  const aliasGroups = await chest.getAliasIdsFromNamespace(namespace, depth);

  // Traiter les résultats - chaque groupe contient les versions ordonnées
  return aliasGroups.map(group => {
    // Le premier élément de chaque groupe est la version la plus récente
    return group[0];
  });
}
```

## Interactions avec d'autres modules

- **[goblin-chronomancer]** : Utilisé pour planifier des tâches périodiques comme la vérification des fichiers manquants et la collecte des fichiers orphelins
- **[xcraft-core-goblin]** : Fournit l'infrastructure Elf pour les acteurs et la gestion des états
- **[xcraft-core-stones]** : Utilisé pour la définition des types de données et la validation
- **[xcraft-core-utils]** : Fournit des utilitaires pour les fichiers, les verrous et les checksums
- **[xcraft-core-etc]** : Gère la configuration du module
- **[xcraft-core-fs]** : Utilisé pour les opérations de listage de fichiers dans le backend
- **[xcraft-core-host]** : Fournit les clés de routage pour les streams

## Configuration avancée

| Option | Description | Type | Valeur par défaut |
|--------|-------------|------|------------------|
| `backend` | Backend pour le stockage | string | `fs` |
| `fs.location` | Emplacement pour stocker les fichiers | string | `null` |
| `fs.maxSize` | Taille maximale pour le stockage (0 = pas de limite) | number | `0` |
| `fs.cipher` | Algorithme de chiffrement par défaut | string | `aes-256-cbc` |
| `fs.compress` | Algorithme de compression par défaut | string | `gzip` |
| `collect.orphans.maxSize` | Taille maximale des orphelins à conserver | number | `0` |
| `chronomancer.missing.time` | Planification CRON pour la vérification des fichiers manquants | string | `0 */1 * * *` |
| `chronomancer.collect.time` | Planification CRON pour la collecte des fichiers à la corbeille | string | `42 3 * * *` |

### Variables d'environnement

Le module utilise la configuration Xcraft standard via `xcraft-core-etc` et ne définit pas de variables d'environnement spécifiques.

## Détails des sources

### `chest.js`

Ce fichier définit l'acteur principal `Chest` qui orchestre toutes les opérations de stockage et de récupération. Il initialise le backend approprié et expose les méthodes principales comme `supply`, `retrieve`, `trash`, etc.

L'acteur `Chest` est un singleton (`Elf.Alone`) qui gère :

- L'initialisation du backend de stockage configuré
- La synchronisation des fichiers entre clients et serveur
- La gestion des fichiers orphelins via des tâches planifiées
- La vérification périodique des fichiers manquants
- Le mode réplica pour les clients

#### État et modèle de données

```javascript
class ChestShape {
  id = string;
}

class ChestState extends Elf.Sculpt(ChestShape) {}
```

L'état du coffre est minimal car il s'agit principalement d'un orchestrateur.

#### Méthodes publiques

**`init(options)`** - Initialise le coffre avec les options spécifiées. Configure le backend, détermine si on est côté client ou serveur, et configure les tâches de synchronisation.

**`setReplica(enable)`** - Active ou désactive le mode réplica, qui modifie le comportement de stockage et les tâches planifiées.

**`supply(xcraftStream, fileName, streamId, chestObjectId, cert, namespace, alias)`** - Stocke un fichier dans le coffre. Retourne l'ID du ChestObject ou du ChestAlias si un namespace est spécifié.

**`retrieve(chestObjectId, key)`** - Récupère un fichier du coffre en utilisant son ID. Retourne un objet avec le stream, la clé de routage et le nom du fichier.

**`location(chestObjectId)`** - Obtient l'emplacement physique d'un fichier dans le backend.

**`locationTry(chestObjectId)`** - Tente d'obtenir l'emplacement d'un fichier, en le récupérant du serveur si nécessaire. Implémente la logique de synchronisation client-serveur.

**`saveAsTry(chestObjectId, outputFile, privateKey)`** - Sauvegarde un fichier du coffre vers un emplacement spécifié sur le système de fichiers.

**`setVectors(chestObjectId, vectors)`** - Définit des vecteurs pour un objet (utilisé pour la recherche vectorielle).

**`trashAlias(chestAliasId)`** - Met un alias à la corbeille.

**`trash(chestObjectId)`** - Met un fichier à la corbeille et supprime le fichier physique du backend.

**`unlink(chestObjectId)`** - Dissocie un fichier (garde l'entrée dans la base de données mais supprime le fichier physique).

**`checkMissing(chestObjectId)`** - Vérifie si un fichier est manquant et émet un événement pour demander sa récupération.

**`getObjectIdFromName(name)`** - Récupère l'ID de l'objet avec la génération la plus élevée pour un nom donné.

**`getObjectIdHistoryFromName(name, limit)`** - Récupère l'historique des versions d'un objet à partir de son nom, limité à un nombre spécifié.

**`getAliasIdsFromNamespace(namespace, depth)`** - Récupère les alias dans un namespace spécifique, groupés par nom avec un historique de profondeur configurable.

### `chestObject.js`

Ce fichier définit l'acteur `ChestObject` qui représente un fichier stocké dans le coffre. Il gère les métadonnées du fichier et son cycle de vie.

#### État et modèle de données

```javascript
class ChestObjectShape {
  id = id('chestObject');
  meta = MetaShape;
  name = string;
  ext = option(string);
  size = number;
  mime = string;
  charset = string;
  encryption = option(EncryptionShape);
  link = enumeration('linked', 'unlinked');
  generation = number;
  metadata = option(MetadataShape);
}
```

Les métadonnées incluent :

```javascript
class MetaShape {
  index = string;
  vectors = option(record(string, array(number)));
  status = enumeration('published', 'trashed');
}

class EncryptionShape {
  cipher = enumeration('aes-256-cbc');
  compress = enumeration('gzip');
  key = string; // Clé symétrique + IV chiffrées avec la clé publique
}

class MetadataShape {
  title = option(string);
  subject = option(string);
  description = option(string);
  languages = option(array(string));
  createDate = option(dateTime);
  modifyDate = option(dateTime);
  authors = option(array(string));
  contributors = option(array(string));
  version = option(string);
}
```

#### Méthodes publiques

**`create(id, desktopId, filePath)`** - Crée un nouvel objet dans le coffre. Le filePath est nettoyé pour extraire uniquement le nom du fichier.

**`upsert(size, mime, charset, cipher, compress, key)`** - Met à jour les informations d'un objet avec les métadonnées du fichier et incrémente automatiquement la génération.

**`setMetadata(metadata)`** - Définit des métadonnées optionnelles pour un objet (titre, auteurs, etc.).

**`setAlias(namespace, name)`** - Crée un alias pour un objet dans un namespace spécifique.

**`setVectors(vectors)`** - Définit des vecteurs pour un objet (utilisé pour la recherche vectorielle).

**`unlink()`** - Dissocie un objet (marque le lien comme 'unlinked').

**`trash()`** - Met un objet à la corbeille et supprime automatiquement tous les alias associés.

### `chestAlias.js`

Ce fichier définit l'acteur `ChestAlias` qui permet de référencer un `ChestObject` via un alias nommé dans un namespace. Cela permet d'avoir des noms conviviaux et organisés pour les fichiers.

#### État et modèle de données

```javascript
class ChestAliasShape {
  id = string;
  meta = MetaShape;
  name = string;
}

class MetaShape {
  index = string;
  status = enumeration('published', 'trashed');
}
```

L'ID d'un alias suit le format : `chestAlias@{namespace}@{chestObjectId}`

#### Méthodes publiques

**`create(id, desktopId, name)`** - Crée un nouvel alias. Le nom est obligatoire lors de la création.

**`upsert(name)`** - Met à jour un alias avec un nouveau nom et remet le statut à 'published'.

**`trash()`** - Met un alias à la corbeille.

### `backend/fs.js`

Ce fichier implémente le backend de stockage basé sur le système de fichiers. Il gère le stockage physique des fichiers dans une structure organisée avec chiffrement et compression.

La classe `SHFS` (Secure Hash File System) utilise :

- Une structure de répertoires basée sur les deux premiers caractères du hash SHA-256
- Un système d'index en mémoire pour la gestion efficace des fichiers
- Un mécanisme de rotation basé sur l'heure d'accès (atime) pour respecter les limites de taille
- Le chiffrement AES avec des clés générées aléatoirement
- La compression GZIP optionnelle

#### Méthodes principales

**`constructor(config)`** - Initialise le backend avec la configuration spécifiée, crée les répertoires nécessaires et construit l'index.

**`setMaxSize(maxSize)`** - Définit la taille maximale du stockage et déclenche la rotation si nécessaire.

**`location(hash)`** - Calcule l'emplacement physique d'un fichier à partir de son hash.

**`getWriteStream()`** - Crée un stream d'écriture temporaire pour un nouveau fichier.

**`put(streamFS, cert)`** - Stocke un fichier dans le backend, avec chiffrement optionnel si un certificat est fourni.

**`get(hash, encryption, key)`** - Récupère un fichier du backend, avec déchiffrement optionnel.

**`exists(hash)`** - Vérifie si un fichier existe dans le backend.

**`del(hash)`** - Supprime un fichier du backend et met à jour l'index.

**`list()`** - Générateur qui liste tous les hash des fichiers dans le backend.

### `test/chestObject.spec.js`

Ce fichier contient les tests unitaires pour la logique du `ChestObject`. Il teste les opérations de base comme la création, la mise à jour, la dissociation et la mise à la corbeille des objets.

Les tests utilisent `Elf.trial()` pour tester la logique sans persistance, permettant de valider le comportement des mutations d'état.

_Cette documentation a été mise à jour automatiquement._

[goblin-chronomancer]: https://github.com/Xcraft-Inc/goblin-chronomancer
[xcraft-core-goblin]: https://github.com/Xcraft-Inc/xcraft-core-goblin
[xcraft-core-stones]: https://github.com/Xcraft-Inc/xcraft-core-stones
[xcraft-core-utils]: https://github.com/Xcraft-Inc/xcraft-core-utils
[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc
[xcraft-core-fs]: https://github.com/Xcraft-Inc/xcraft-core-fs
[xcraft-core-host]: https://github.com/Xcraft-Inc/xcraft-core-host