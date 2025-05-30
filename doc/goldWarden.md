# GoldWarden

## Aperçu

Le **GoldWarden** est un acteur singleton du framework Xcraft qui surveille et synchronise automatiquement un répertoire de fichiers partagés avec un système de stockage centralisé (Chest). Il agit comme un gardien intelligent qui détecte les modifications de fichiers dans un répertoire local et les propage vers le système de stockage distribué, tout en gérant optionnellement la synchronisation Git pour la collaboration.

## Fonctionnement

### Architecture et responsabilités

Le GoldWarden fonctionne comme un pont entre :

- Un **répertoire local** surveillé (repository)
- Le système de **stockage Chest** (via les acteurs Gold)
- Un **dépôt Git distant** (optionnel) pour la synchronisation

```
Répertoire local ←→ GoldWarden ←→ Chest Storage
       ↕                              ↕
   Git Repository ←←←←←←←←←←←←→ Clients distants
```

### Démarrage et initialisation

Au démarrage, le GoldWarden :

1. **Charge la configuration** depuis `goblin-chest.gold`
2. **Détermine le répertoire à surveiller** selon cette priorité :
   - Paramètre `goldPath` explicite
   - `projectPath/share` en mode développement (côté serveur uniquement)
   - `appConfigPath/var/share` avec Git activé
3. **Configure la synchronisation Git** si un remote est spécifié
4. **Initialise la surveillance** avec Chokidar
5. **Synchronise l'état initial** entre le répertoire et la base de données

#### Diagramme de séquence du démarrage

```
GoldWarden -> Config: load('goblin-chest')
GoldWarden -> FileSystem: check goldPath existence
GoldWarden -> Git: clone/reset repository (si configuré)
GoldWarden -> Chronomancer: setup git sync schedule
GoldWarden -> Chokidar: watch directory
GoldWarden -> Database: query existing Gold entries
GoldWarden -> GoldWarden: trash orphaned entries
```

### Surveillance des fichiers

Le GoldWarden utilise **Chokidar** pour surveiller les événements du système de fichiers :

#### Événements gérés

- **`add`** : Nouveau fichier détecté → Création d'un acteur Gold
- **`change`** : Fichier modifié → Mise à jour de l'acteur Gold
- **`unlink`** : Fichier supprimé → Suppression de l'acteur Gold

#### Filtrage par namespace

Seuls les fichiers dans les namespaces configurés (`gold.namespaces`) sont surveillés. La structure attendue est :

```
goldPath/
├── namespace1/
│   ├── file1.txt
│   └── subdir/file2.pdf
└── namespace2/
    └── document.docx
```

Le filtrage s'effectue en ignorant les fichiers dont le premier segment du chemin relatif ne correspond pas à un namespace autorisé.

### Gestion des acteurs Gold

Pour chaque fichier surveillé, le GoldWarden :

1. **Génère un ID Gold** basé sur le chemin relatif via `goldIdFromFile()` : `gold@namespace@subdir@filename`
2. **Crée/met à jour l'acteur Gold** correspondant
3. **Appelle `gold.provide(filePath)`** pour stocker le fichier dans le Chest

#### Diagramme de séquence pour un nouveau fichier

```
Chokidar -> GoldWarden: 'add' event (filePath)
GoldWarden -> GoldWarden: goldIdFromFile(filePath)
GoldWarden -> Gold: create(goldId, feedId)
GoldWarden -> Gold: provide(filePath)
Gold -> Chest: supply(filePath, namespace, alias)
Chest -> Backend: store file with hash
GoldWarden -> Git: stage file (si activé)
```

### Synchronisation Git

Quand la synchronisation Git est activée :

#### Configuration requise

- `gold.git.remote` : URL du dépôt distant
- `gold.git.time` : Expression CRON pour la synchronisation (défaut: `*/5 * * * *`)

#### Processus de synchronisation

1. **Détermination de la branche** :
   - `master` en mode développement
   - `X.Y` basé sur `appVersion` en production (ex: `1.2` pour version `1.2.3`)

2. **Opérations Git** (avec verrou mutex `goldWarden-git-sync`) :
   - `git checkout <branch>`
   - `git pull -f`
   - Staging des fichiers accumulés
   - `git commit -m "Update files"` (si modifications)
   - `git push` (uniquement en production)

#### Staging des modifications

Le GoldWarden maintient une Map `_staging` qui accumule les modifications :

- Ajout de fichier → `staging.set(filePath, 'add')`
- Suppression → `staging.set(filePath, 'rm')`
- Synchronisation différée (debounce 1000ms) → `_gitSyncDebouned()`

La fonction `stageFiles()` traite les modifications accumulées en séparant les actions d'ajout et de suppression, puis retourne un booléen indiquant s'il y a du contenu en staging.

### Gestion des modes de fonctionnement

#### Mode client

En mode client (quand `goblinConfig.actionsSync?.enable` est activé), le GoldWarden reste inactif et ne surveille aucun répertoire. La synchronisation des fichiers se fait via le système de réplication Chest.

#### Mode développement (serveur)

- Répertoire : `projectPath/share`
- Pas de synchronisation Git automatique (pas de push)
- Surveillance directe du répertoire local
- Commits locaux uniquement

#### Mode production avec Git (serveur)

- Répertoire : `appConfigPath/var/share`
- Clone automatique du dépôt distant si inexistant
- Synchronisation bidirectionnelle programmée avec push
- Gestion des branches par version
- Reset automatique au démarrage pour un état propre

#### Mode désactivé

- Aucun répertoire configuré ou accessible
- Le GoldWarden reste inactif (`_disabled = true`)
- Les acteurs Gold utilisent le fallback `readonlyShare`

### Nettoyage et cohérence

#### Suppression des orphelins

Lors de l'événement `ready` de Chokidar, le GoldWarden :

1. Compare les fichiers détectés initialement avec les entrées Gold en base
2. Identifie les acteurs Gold sans fichier correspondant
3. Supprime automatiquement ces entrées orphelines via `_trashGolds()`

#### Gestion des erreurs

- Verrous mutex pour éviter les conflits Git
- Validation du format de branche en production (`/^[0-9]+[.][0-9]+$/`)
- Logs détaillés pour le débogage
- Gestion des échecs de clone/pull/push

### Cycle de vie détaillé

#### Initialisation (`init`)

La méthode `init()` accepte des options de type `ChestOptions` et appelle `_reload()` qui :

1. **Arrête les tâches Chronomancer** existantes (`goldWardenGit`)
2. **Nettoie le staging Git** si actif
3. **Détermine le goldPath** selon la priorité configurée
4. **Configure Git** si un remote est spécifié et que Git est disponible
5. **Initialise la surveillance Chokidar** avec filtrage par namespace

#### Surveillance active

Une fois initialisé, le GoldWarden :

- **Surveille en continu** les modifications de fichiers via Chokidar
- **Synchronise automatiquement** selon le planning CRON configuré
- **Maintient la cohérence** entre répertoire et base de données

#### Nettoyage (`dispose`)

La méthode `dispose()` assure un arrêt propre :

- Fermeture du watcher Chokidar via `unwatch()` et `close()`
- Libération des ressources de surveillance
- Les tâches Chronomancer sont arrêtées lors du `_reload()`

### API publique

#### Méthodes principales

- **`repository()`** : Retourne le chemin du répertoire surveillé ou `null` si désactivé
- **`setGoldPath(goldPath)`** : Change le répertoire surveillé dynamiquement

#### Configuration dynamique

Le GoldWarden peut être reconfiguré à chaud via `setGoldPath()`, ce qui :

1. Arrête la surveillance actuelle si le chemin change
2. Appelle `_reload()` avec le nouveau chemin
3. Redémarre la surveillance et la synchronisation

### Intégration avec le système Chest

#### Relation avec les acteurs Gold

Le GoldWarden orchestre les acteurs Gold mais ne gère pas directement le stockage :

- **Création automatique** des acteurs Gold pour chaque fichier détecté
- **Délégation du stockage** via `gold.provide(filePath)`
- **Nettoyage automatique** lors de la suppression de fichiers via `gold.trash()`

#### Synchronisation avec la base de données

- Utilisation de `GoldLogic.db` pour les requêtes sur les entrées Gold
- Comparaison entre fichiers détectés et entrées existantes
- Suppression des entrées orphelines lors de l'initialisation

### Fonctions utilitaires

#### Gestion des identifiants Gold

- **`goldIdFromFile(file)`** : Convertit un chemin de fichier en identifiant Gold en encodant chaque segment du chemin
- **`fileFromGoldId(goldId)`** : Convertit un identifiant Gold en chemin de fichier en décodant les segments

#### Classe Git intégrée

Le GoldWarden utilise une classe `Git` dédiée qui encapsule les opérations Git avec :

- Vérification de la disponibilité de l'exécutable `git` via `Git.available`
- Gestion des codes de retour et messages d'erreur
- Environnement `LANG=C` pour des messages standardisés
- Support des opérations : `clone`, `checkout`, `pull`, `add`, `rm`, `commit`, `push`, `reset`, `staged`

### Gestion avancée de la synchronisation

#### Stratégie de branchement

Le système de branches suit une logique spécifique selon l'environnement :

- **Mode développement** (`NODE_ENV=development`) : Branche `master`
- **Mode production** : Branche `X.Y` extraite de `appVersion`
  - Validation stricte du format par regex
  - Erreur si le format de version n'est pas supporté

#### Optimisations de performance

- **Debounce de 1000ms** pour éviter les synchronisations trop fréquentes
- **Staging accumulé** pour grouper les modifications
- **Verrous mutex** pour éviter les conflits concurrents
- **Surveillance sélective** par namespace pour réduire la charge

#### Robustesse et récupération

- **Reset Git automatique** au démarrage pour un état propre
- **Clone automatique** si le répertoire Git n'existe pas
- **Gestion des erreurs de réseau** lors des opérations distantes
- **Logs détaillés** pour le diagnostic et le débogage

### Conditions d'activation

Le GoldWarden ne s'active que si plusieurs conditions sont réunies :

1. **Pas en mode client** : `goblinConfig.actionsSync?.enable` doit être false ou undefined
2. **Répertoire accessible** : Le `goldPath` doit exister et être accessible
3. **Namespaces configurés** : Au moins un namespace doit être défini dans `gold.namespaces`
4. **Git disponible** (optionnel) : Si la synchronisation Git est requise, l'exécutable `git` doit être présent

Si ces conditions ne sont pas remplies, le GoldWarden reste en mode désactivé et les acteurs Gold utilisent les mécanismes de fallback.

---

_Documentation mise à jour automatiquement à partir du code source._