# Asset 3D / Asset 2.5D / 3D animé

Application Android Java servant de catalogue d’assets libres de droit.

## Interface

L’écran de démarrage affiche directement :

- **Asset 3D**
- **Asset 2.5D**
- **3D animé**

La bannière principale utilise l’image Albator fournie pour le projet.

## Configuration Android

- Java uniquement
- minSdk 21
- targetSdk 34
- compileSdk 34
- Gradle 8.7
- Android Gradle Plugin 8.5.2

## Compilation

```bash
chmod +x gradlew
./gradlew assembleDebug
```

L’APK est généré dans :

```text
app/build/outputs/apk/debug/app-debug.apk
```

GitHub Actions compile aussi automatiquement l’APK et le publie dans les Artifacts.

## MCP du projet

Le dépôt contient maintenant un serveur **Model Context Protocol** dédié dans `mcp/`.

Il permet à un assistant compatible MCP de :

- inspecter la structure du projet ;
- lire et modifier les fichiers texte du dépôt ;
- lister et rechercher les assets 3D, 2.5D et 3D animés ;
- valider les licences, URL, doublons et images de prévisualisation ;
- lancer des tâches Gradle Android contrôlées.

Installation :

```bash
cd mcp
npm install
npm run build
```

La configuration de lancement est disponible dans `.mcp.json`. Voir `mcp/README.md` pour les détails.
