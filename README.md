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
