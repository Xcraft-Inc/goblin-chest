# 📘 Documentation du module goblin-chest

## Aperçu

Le module `goblin-chest` est un système de stockage de fichiers avancé pour l'écosystème Xcraft. Il fournit une solution complète pour gérer le cycle de vie des fichiers avec des fonctionnalités de chiffrement, compression, versionnement et aliasing. Ce module agit comme un coffre-fort sécurisé pour les fichiers, permettant leur stockage, récupération et gestion efficace dans une application Xcraft.

## Structure du module

Le module s'articule autour de cinq acteurs Elf principaux :

1. **Chest** - L'acteur principal singleton qui orchestre le stockage et la récupération des fichiers
2. **ChestObject** - Représente un fichier individuel stocké dans le coffre avec ses métadonnées
3. **ChestAlias** - Permet de créer des références nommées vers des ChestObjects dans des espaces de noms spécifiques
4. **Gold** - Gère les fichiers avec un cycle de vie simplifié et des alias automatiques
5. **GoldWarden** - Surveille le système de fichiers pour synchroniser automatiquement les fichiers Gold

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

### Utiliser Gold pour la gestion simplifiée

```javascript
// Dans une méthode d'un acteur Elf
async updateGoldFile(goldId, filePath) {
  const feedId = await this.newQuestFeed();
  const gold = await new Gold(this).create(goldId, feedId);
  
  // Met à jour le fichier Gold (crée un nouvel alias si le fichier a changé)
  await gold.provide(filePath);
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
| `gold.namespaces` | Espaces de noms supportés pour le Gold Warden | array | `[]` |

### Variables d'environnement

Le module utilise la configuration Xcraft standard via `xcraft-core-etc` et ne définit pas de variables d'environnement spécifiques. Le GoldWarden est activé uniquement en mode développement (`NODE_ENV === 'development'`).

## Détails des acteurs

### Acteur Chest (Singleton)

L'acteur principal `Chest` est un singleton (`Elf.Alone`) qui orchestre toutes les opérations de stockage et de récupération.

#### État et modèle de données

```javascript
class ChestShape {
  id = string;
}
```

L'état du coffre est minimal car il s'agit principalement d'un orchestrateur.

#### Cycle de vie

- **`init(options)`** : Initialise le coffre avec les options spécifiées. Configure le backend, détermine si on est côté client ou serveur, et configure les tâches de synchronisation.

#### Méthodes principales

**Gestion des fichiers :**
- `supply(xcraftStream, fileName, streamId, chestObjectId, cert, namespace, alias)` - Stocke un fichier dans le coffre
- `retrieve(chestObjectId, key)` - Récupère un fichier du coffre
- `location(chestObjectId)` - Obtient l'emplacement physique d'un fichier
- `locationTry(chestObjectId)` - Tente d'obtenir l'emplacement avec synchronisation automatique
- `saveAsTry(chestObjectId, outputFile, privateKey)` - Sauvegarde un fichier vers le système de fichiers

**Gestion du cycle de vie :**
- `trash(chestObjectId)` - Met un fichier à la corbeille
- `unlink(chestObjectId)` - Dissocie un fichier
- `trashAlias(chestAliasId)` - Met un alias à la corbeille

**Recherche et navigation :**
- `getObjectIdFromName(name)` - Récupère l'ID de la dernière version d'un fichier par nom
- `getObjectIdHistoryFromName(name, limit)` - Récupère l'historique des versions
- `getAliasIdsFromNamespace(namespace, depth)` - Liste les alias dans un namespace

**Fonctionnalités avancées :**
- `setVectors(chestObjectId, vectors)` - Définit des vecteurs pour la recherche vectorielle
- `setReplica(enable)` - Active/désactive le mode réplica
- `checkMissing(chestObjectId)` - Vérifie et demande la récupération de fichiers manquants

### Acteur ChestObject

Représente un fichier individuel stocké dans le coffre avec ses métadonnées complètes.

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

**Métadonnées système :**
```javascript
class MetaShape {
  index = string;
  vectors = option(record(string, array(number))); // Pour la recherche vectorielle
  status = enumeration('published', 'trashed');
}
```

**Chiffrement :**
```javascript
class EncryptionShape {
  cipher = enumeration('aes-256-cbc');
  compress = enumeration('gzip');
  key = string; // Clé symétrique + IV chiffrées avec la clé publique
}
```

**Métadonnées documentaires :**
```javascript
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

#### Cycle de vie

- **`create(id, desktopId, filePath)`** : Crée un nouvel objet dans le coffre

#### Méthodes principales

- `upsert(size, mime, charset, cipher, compress, key)` - Met à jour les informations avec incrémentation automatique de génération
- `setMetadata(metadata)` - Définit des métadonnées documentaires
- `setAlias(namespace, name)` - Crée un alias pour l'objet
- `setVectors(vectors)` - Définit des vecteurs pour la recherche
- `unlink()` - Dissocie l'objet (garde l'entrée DB, supprime le fichier physique)
- `trash()` - Met l'objet à la corbeille et supprime tous les alias associés

### Acteur ChestAlias

Permet de référencer un `ChestObject` via un alias nommé dans un namespace organisé.

#### État et modèle de données

```javascript
class ChestAliasShape {
  id = string; // Format: chestAlias@{namespace}@{chestObjectId}
  meta = MetaShape;
  name = string;
}
```

#### Cycle de vie

- **`create(id, desktopId, name)`** : Crée un nouvel alias (nom obligatoire)

#### Méthodes principales

- `upsert(name)` - Met à jour l'alias avec un nouveau nom
- `trash()` - Met l'alias à la corbeille

### Acteur Gold

L'acteur `Gold` fournit une interface simplifiée pour gérer des fichiers avec un cycle de vie automatisé et des alias intégrés.

#### État et modèle de données

```javascript
class GoldShape {
  id = id('gold');
  chestAliasId = option(id('chestAlias'));
  meta = MetaShape;
}
```

#### Cycle de vie

- **`create(id, desktopId)`** : Crée un nouvel acteur Gold

#### Méthodes principales

- `provide(file)` - Met à jour le fichier associé (crée automatiquement un alias si le fichier change)
- `retrieve()` - Récupère l'emplacement du fichier associé
- `trash()` - Met le Gold et son alias associé à la corbeille

#### Fonctionnement

L'acteur Gold simplifie la gestion des fichiers en :
- Créant automatiquement des alias dans un namespace basé sur l'ID du Gold
- Vérifiant si le fichier a changé avant de créer une nouvelle version
- Gérant automatiquement le cycle de vie des alias associés

### Acteur GoldWarden (Singleton)

Le `GoldWarden` est un singleton qui surveille le système de fichiers pour synchroniser automatiquement les fichiers Gold.

#### État et modèle de données

```javascript
class GoldWardenShape {
  id = string;
}
```

#### Cycle de vie

- **`init()`** : Initialise la surveillance du système de fichiers (uniquement en mode développement)

#### Fonctionnement

Le GoldWarden :
- Surveille le répertoire `share` du projet en mode développement
- Détecte automatiquement les ajouts, modifications et suppressions de fichiers
- Crée/met à jour automatiquement les acteurs Gold correspondants
- Filtre les fichiers selon les namespaces configurés
- Génère des IDs Gold basés sur la structure de répertoires

#### Méthodes privées

- `_update(goldId, file)` - Met à jour un fichier Gold détecté
- `_trash(golds)` - Met à la corbeille les Gold des fichiers supprimés

## Backend de stockage

### Backend FileSystem (SHFS)

Le backend par défaut implémente un système de fichiers sécurisé avec hash (`SHFS` - Secure Hash File System).

#### Caractéristiques

- **Structure organisée** : Répertoires basés sur les 2 premiers caractères du hash SHA-256
- **Index en mémoire** : Gestion efficace avec tri par heure d'accès (atime)
- **Rotation automatique** : Suppression des fichiers les plus anciens selon la limite de taille
- **Chiffrement AES-256-CBC** : Avec clés générées aléatoirement
- **Compression GZIP** : Optionnelle pour réduire l'espace de stockage

#### Méthodes principales

- `put(streamFS, cert)` - Stocke un fichier avec chiffrement optionnel
- `get(hash, encryption, key)` - Récupère un fichier avec déchiffrement optionnel
- `exists(hash)` - Vérifie l'existence d'un fichier
- `del(hash)` - Supprime un fichier et met à jour l'index
- `location(hash)` - Calcule l'emplacement physique
- `setMaxSize(maxSize)` - Configure la limite de taille avec rotation automatique

#### Chiffrement et déchiffrement

Le backend gère le chiffrement hybride :
- Génération d'une clé AES et d'un IV aléatoires
- Chiffrement du fichier avec AES-256-CBC
- Chiffrement de la clé AES + IV avec la clé publique RSA (OAEP padding)
- Stockage de la clé chiffrée en base64 dans les métadonnées

## Tests

Le module inclut des tests unitaires pour valider le comportement des acteurs :

```javascript
// Exemple de test pour ChestObject
const objectLogic = Elf.trial(ChestObjectLogic);
objectLogic.create('chestObject@test', '/home/yeti/foobar.obj');
objectLogic.upsert(42, 'image/png', 'binary', 'aes-256-cbc', 'gzip', 'key', 1);
```

Les tests utilisent `Elf.trial()` pour tester la logique sans persistance, permettant de valider le comportement des mutations d'état.

## Sécurité et performance

### Sécurité

- **Chiffrement hybride** : Combinaison de chiffrement symétrique (AES) et asymétrique (RSA)
- **Clés uniques** : Génération de clés et IV aléatoires pour chaque fichier
- **Isolation des données** : Structure de hash empêchant la prédiction des emplacements
- **Gestion sécurisée des clés** : Les clés symétriques sont chiffrées avec des clés publiques
- **Sanitisation des noms** : Nettoyage automatique des noms de fichiers pour éviter les attaques de traversée de répertoires

### Performance

- **Déduplication automatique** : Les fichiers identiques (même hash) ne sont stockés qu'une fois
- **Index en mémoire** : Accès rapide aux métadonnées des fichiers
- **Streaming** : Traitement des fichiers par flux pour gérer de gros volumes
- **Compression** : Réduction de l'espace de stockage avec GZIP
- **Rotation intelligente** : Suppression des fichiers les moins récemment utilisés
- **Surveillance temps réel** : Le GoldWarden utilise `chokidar` pour une surveillance efficace du système de fichiers

## Architecture et patterns

### Pattern Actor Model

Le module suit le pattern Actor Model d'Xcraft avec :
- **Isolation des états** : Chaque acteur gère son propre état
- **Communication par messages** : Les acteurs communiquent via des quêtes
- **Persistance automatique** : Les états sont automatiquement persistés dans la base de données

### Pattern Repository

Le Chest agit comme un repository centralisé pour :
- **Abstraction du stockage** : Interface unifiée indépendante du backend
- **Gestion des métadonnées** : Centralisation des informations sur les fichiers
- **Orchestration** : Coordination entre les différents acteurs

### Pattern Observer

Le GoldWarden implémente le pattern Observer pour :
- **Surveillance passive** : Réaction aux changements du système de fichiers
- **Synchronisation automatique** : Mise à jour transparente des acteurs Gold
- **Découplage** : Séparation entre la détection des changements et leur traitement

_Cette documentation a été générée automatiquement à partir du code source._

[goblin-chronomancer]: https://github.com/Xcraft-Inc/goblin-chronomancer
[xcraft-core-goblin]: https://github.com/Xcraft-Inc/xcraft-core-goblin
[xcraft-core-stones]: https://github.com/Xcraft-Inc/xcraft-core-stones
[xcraft-core-utils]: https://github.com/Xcraft-Inc/xcraft-core-utils
[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc
[xcraft-core-fs]: https://github.com/Xcraft-Inc/xcraft-core-fs
[xcraft-core-host]: https://github.com/Xcraft-Inc/xcraft-core-host