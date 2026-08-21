# MCP — Asset 3D / Asset 2.5D

Ce dossier contient un serveur **Model Context Protocol (MCP)** dédié au dépôt Android.

## Objectif

Permettre à un assistant compatible MCP de travailler sur le projet avec des outils ciblés, sans exposer librement tout le système de fichiers.

## Outils disponibles

- `project_summary` : résumé du projet et nombre d'assets par catégorie.
- `list_project_files` : inventaire des fichiers du dépôt.
- `read_project_file` : lecture des fichiers texte du projet.
- `write_project_file` : création ou remplacement contrôlé d'un fichier texte.
- `replace_in_project_file` : remplacement exact avec vérification du nombre d'occurrences.
- `list_assets` : liste du catalogue 3D / 2.5D / 3D animé.
- `search_assets` : recherche dans le catalogue.
- `validate_catalog` : contrôle des doublons, licences, URL et drawables.
- `run_gradle_task` : compilation/tests avec une liste de tâches Gradle autorisées.

## Installation

Depuis la racine du dépôt :

```bash
cd mcp
npm install
npm run build
```

Puis :

```bash
npm start
```

Le transport utilisé est `stdio`.

## Configuration MCP

Le fichier `.mcp.json` placé à la racine permet aux clients qui reconnaissent cette convention de lancer le serveur depuis le dépôt.

Exemple générique :

```json
{
  "mcpServers": {
    "asset-3d-25d": {
      "command": "npm",
      "args": ["--prefix", "mcp", "start"],
      "env": {
        "ASSET_PROJECT_ROOT": "."
      }
    }
  }
}
```

## Sécurité

Le serveur refuse les écritures dans les zones sensibles ou générées, notamment :

- `.git/`
- `.gradle/`
- `.idea/`
- `build/`
- `app/build/`
- `node_modules/`
- `mcp/dist/`

Les tâches Gradle sont limitées à : `assembleDebug`, `lintDebug`, `testDebugUnitTest` et `clean`.
