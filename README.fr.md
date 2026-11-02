# Hobart Warewash MCP

[English](README.md) | **Français**

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Node.js >= 22.12](https://img.shields.io/badge/node-%3E%3D22.12-339933)
![MCP](https://img.shields.io/badge/MCP-stdio%20%2B%20Streamable%20HTTP-6f42c1)
![Non officiel](https://img.shields.io/badge/Hobart-non%20officiel-lightgrey)

Un **serveur MCP pour lave-vaisselle Hobart** : il connecte les
**lave-vaisselle professionnels Hobart** reliés à **Hobart SmartConnect**
aux assistants IA comme **Claude** et **ChatGPT**, via l'**API Hobart
Cloud-to-Cloud (C2C), Visiotronic 1.5** :

- les machines enregistrées sur votre compte, et leur dernier contact
- les erreurs actives
- les températures de lavage et de rinçage, le dernier programme
- les consommations du jour : eau, énergie, détergent, produit de rinçage
- le **protocole d'hygiène** : une entrée par cycle de lavage, avec son programme
- en option : enregistrer une machine, modifier dosages, densités et
  horaires de démarrage automatique, seulement si vous l'activez, et
  seulement après votre confirmation

Il est **en lecture seule par défaut** : les outils d'écriture n'existent
pas tant que `HOBART_ALLOW_WRITE=true` n'est pas défini.

> **Non officiel.** Projet personnel indépendant, sans lien avec Hobart
> ni ITW Food Equipment Group. Il faut vos propres identifiants pour
> l'API Hobart Cloud-to-Cloud.

> **Statut : version initiale (0.1.0).** Validé sur l'API Hobart C2C réelle
> avec des machines Hobart AMXXS-B-SEF. Retours bienvenus.

## Pourquoi ?

Un lave-vaisselle Hobart connecté enregistre des données utiles
(températures, erreurs, consommations, chaque cycle), mais elles restent
dans l'app Hobart SmartConnect, où l'on peut les consulter, pas les
interroger.

Ce serveur fait le pont entre l'API Hobart C2C et n'importe quel client
[Model Context Protocol](https://modelcontextprotocol.io). Posez votre
question en français, _« Le lave-vaisselle de la cuisine centrale a-t-il
atteint sa température de rinçage aujourd'hui ? »_, et l'assistant appelle
un outil précis et répond à partir des données de la machine, sans deviner.

En novembre 2026, il n'existait aucun autre serveur MCP, plugin ou SDK
public pour l'API Hobart C2C / SmartConnect (recherche : registres MCP,
GitHub, npm, PyPI).

## Démarrage rapide

### 1. Enregistrer vos identifiants Hobart

Créez `~/.config/hobart-warewash-mcp/.env` (sous Windows
`%USERPROFILE%\.config\hobart-warewash-mcp\.env`) :

```bash
HOBART_USERNAME=vous@exemple.fr
HOBART_PASSWORD=votre-mot-de-passe
# HOBART_ALLOW_WRITE=true   # seulement pour activer les outils d'écriture
```

Les variables d'environnement, si elles sont définies, priment sur ce fichier.

### 2. Connecter votre assistant IA

**Claude Code : plugin (serveur MCP + skill)**

```bash
claude plugin marketplace add christophe77/hobart-warewash-mcp
claude plugin install hobart-warewash@hobart-warewash-mcp
```

**Claude Desktop, Cursor, VS Code, Windsurf, Cline… (stdio local)**

```json
{
  "mcpServers": {
    "hobart-warewash": {
      "command": "npx",
      "args": ["-y", "hobart-warewash-mcp@0.1.0"]
    }
  }
}
```

### Depuis les sources

```bash
git clone https://github.com/christophe77/hobart-warewash-mcp.git
cd hobart-warewash-mcp
npm install
npm run build
cp .env.example .env    # renseigner HOBART_USERNAME et HOBART_PASSWORD
node scripts/smoke.mjs  # appelle tous les outils de lecture sur l'API réelle
```

### ChatGPT et claude.ai (connecteur distant)

Les assistants web et mobiles n'acceptent que des serveurs MCP distants
en HTTPS :

```bash
npx -y hobart-warewash-mcp@0.1.0 --http         # http://127.0.0.1:3333/mcp
cloudflared tunnel --url http://localhost:3333  # ou : ngrok http 3333
```

URL du connecteur : `https://<votre-hôte>/mcp/<MCP_HTTP_SECRET>`.

- **ChatGPT** : Paramètres → Apps et connecteurs → Avancé → Mode
  développeur → Créer ; coller l'URL ; authentification « Aucune ».
- **claude.ai** : Paramètres → Connecteurs → Ajouter un connecteur
  personnalisé ; coller l'URL.

## Exemples de questions

- « Liste mes lave-vaisselle Hobart et dis-moi lesquels n'ont rien remonté depuis une semaine. »
- « Est-ce que le lave-vaisselle 867237207 va bien ? »
- « Quelles étaient les températures de lavage et de rinçage au dernier cycle ? »
- « Combien d'eau et d'énergie chaque machine a consommé hier ? »
- « Montre-moi le protocole d'hygiène du jour : combien de cycles, quels programmes ? »
- En mode écriture : « Règle le démarrage automatique n°1 à 06:30 ». L'assistant
  lit la valeur actuelle, affiche ancien → nouveau, et attend votre accord.

## Outils MCP

| Outil                      | Répond à                                                       | Accès    |
| -------------------------- | -------------------------------------------------------------- | -------- |
| `hobart_list_machines`     | Machines du compte, type, protocole, dernier contact           | lecture  |
| `hobart_machine_overview`  | Erreurs + températures + consommations, en un appel            | lecture  |
| `hobart_get_machine_data`  | Tous les paramètres, compteurs, protocole d'hygiène            | lecture  |
| `hobart_get_active_errors` | Erreurs actives (cache 30 s, limite Hobart)                    | lecture  |
| `hobart_get_temperatures`  | Lavage (A270) / rinçage (A283) en °C, dernier programme (cache 60 s) | lecture  |
| `hobart_ping`              | API joignable, compte accepté                                  | lecture  |
| `hobart_register_machine`  | Enregistrer une machine avec son code à 6 caractères           | écriture |
| `hobart_update_settings`   | Dosages, densités, démarrage automatique                       | écriture |

## FAQ

**Existe-t-il un serveur MCP officiel Hobart ?**
Pas à notre connaissance. Ce projet, non officiel, expose l'API
Cloud-to-Cloud de Hobart sous forme de serveur MCP.

**Quelles machines Hobart sont compatibles ?**
Toutes celles que votre compte Hobart C2C voit, c'est-à-dire les
lave-vaisselle Hobart connectés via SmartConnect. Testé sur AMXXS-B-SEF.

**Ça marche avec ChatGPT ?**
Oui, comme connecteur distant (mode développeur), via le mode HTTP. Et
avec Claude (Desktop, Code, claude.ai) et tout client MCP.

**L'IA peut-elle modifier les réglages toute seule ?**
Non. L'écriture est désactivée par défaut ; une fois activée, l'assistant
doit présenter la modification et obtenir votre accord explicite.

**Les données sont-elles en temps réel ?**
Erreurs et températures : quasi temps réel (limites Hobart de 30 s / 60 s).
Données du jour : mises à jour après l'arrêt de la machine ou avant minuit.

**Utile pour l'HACCP ?**
Le protocole d'hygiène et les températures peuvent être résumés par
l'assistant, mais ne remplacent pas vos enregistrements HACCP officiels.

## Licence

[Apache-2.0](LICENSE)

## Avertissement

Projet open source indépendant, sans lien avec Hobart ni ITW Food
Equipment Group, ni approuvé par eux. « Hobart » et « SmartConnect » sont
des marques de leurs propriétaires, citées uniquement pour décrire la
compatibilité. Utilisation à vos risques ; la sécurité alimentaire ne doit
jamais dépendre d'un assistant IA.
