# Curve Controller pour Home Assistant

[![HACS Badge](https://img.shields.io/badge/HACS-Custom-orange.svg?style=for-the-badge)](https://github.com/hacs/default)
[![GitHub Release](https://img.shields.io/github/v/release/pyriec/Curve-Controller?style=for-the-badge&color=blue)](https://github.com/pyriec/Curve-Controller/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg?style=for-the-badge)](LICENSE)

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=pyriec&repository=Curve-Controller&category=integration)

**Curve Controller** est une intégration Home Assistant personnalisée (custom integration) prête pour HACS avec sa carte Lovelace interactive dédiée. Elle permet de relier dynamiquement une **entité source** (ex. température extérieure, humidité, qualité de l'air) à une **entité cible** (consigne de chauffage, vitesse de VMC, position de volet, etc.) en appliquant une **courbe point par point** avec interpolation linéaire par morceaux et clamping automatique.

---

## ✨ Fonctionnalités Principales

- **Multi-courbes personnalisées :** Définissez plusieurs profils pour un même contrôleur (ex. *Hiver*, *Été*, *Nuit*, *Absent*, *Confort*).
- **Interpolation Linéaire par Morceaux & Paliers :** Calcul mathématique exact entre chaque point consécutif, respect parfait des paliers constants ($Y_1 = Y_2$).
- **Clamping Automatique :** Si l'entrée $X$ est inférieure au premier point ou supérieure au dernier, la consigne $Y$ reste bridée respectivement à la valeur du premier ou du dernier point.
- **Carte Lovelace interactive (`curve-controller-card`) :**
  - Tracé vectoriel SVG haute résolution avec axes et repères.
  - **Marqueur dynamique temps réel & Badges sur les axes :** visualisez instantanément le point de fonctionnement actuel avec ses unités directement projetées sur les axes X et Y.
  - **Bouton d'interruption/reprise de la régulation :** suspendez la régulation directement depuis l'en-tête de la carte ou via l'entité switch dédiée.
  - Éditeur de coordonnées stable : saisie numérique libre des points (y compris négatifs et décimaux) sans perte de focus.
  - Bascule en un clic de la courbe active en production.
- **Entité Switch dédiée :** Une entité `switch.curve_controller_<instance>_regulation` pour suspendre/reprendre l'asservissement depuis n'importe quel tableau de bord ou automatisation.
- **Support large d'entités cibles :**
  - `input_number.*` / `number.*` (`set_value`)
  - `climate.*` (`set_temperature`)
  - `fan.*` (`set_percentage`)
  - `cover.*` (`set_cover_position`)
  - `light.*` (`brightness_pct`)
- **Persistance native :** Stockage sécurisé des courbes et des réglages via le système `Store` natif de Home Assistant.
- **Services Home Assistant dédiés :** Automatisez les changements de profils depuis vos scènes ou automatisations.

---

## 📐 Principe Mathématique

Pour une série de points $(X_0, Y_0), (X_1, Y_1), \dots, (X_{n-1}, Y_{n-1})$ ordonnés selon $X$ :

1. **Clamping inférieur :** Si $X \le X_0$, alors $Y = Y_0$.
2. **Clamping supérieur :** Si $X \ge X_{n-1}$, alors $Y = Y_{n-1}$.
3. **Interpolation intermédiaire :** Pour $X_i \le X \le X_{i+1}$ :
   $$\text{Pente} = \frac{Y_{i+1} - Y_i}{X_{i+1} - X_i}$$
   $$Y = Y_i + (X - X_i) \times \text{Pente}$$
4. **Paliers horizontaux :** Si $Y_i = Y_{i+1}$, la consigne reste rigoureusement constante sur tout l'intervalle $[X_i, X_{i+1}]$.

---

## 🚀 Installation

### Méthode 1 : Via HACS (Recommandée)

1. Cliquez sur le badge interactif ci-dessous pour ouvrir directement le dépôt dans votre Home Assistant :

   [![Ouvrir dans Home Assistant](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=pyriec&repository=Curve-Controller&category=integration)

2. Ou manuellement dans HACS :
   - Ouvrez **HACS** > Menu 3 points (en haut à droite) > **Dépôts personnalisés**.
   - Collez l'URL : `https://github.com/pyriec/Curve-Controller`.
   - Catégorie : **Intégration**.
   - Cliquez sur **Ajouter**, puis recherchez **Curve Controller** et cliquez sur **Télécharger**.
3. Redémarrez Home Assistant.

### Méthode 2 : Installation Manuelle

1. Téléchargez la dernière archive depuis la page [Releases](https://github.com/pyriec/Curve-Controller/releases).
2. Copiez le dossier `custom_components/curve_controller` dans le répertoire `<config>/custom_components/` de votre serveur Home Assistant.
3. Redémarrez Home Assistant.

---

## ⚙️ Configuration

1. Rendez-vous dans **Paramètres** > **Appareils et services** > **Ajouter une intégration**.
2. Recherchez **Curve Controller**.
3. Remplissez le formulaire de configuration :
   - **Nom de l'instance :** Ex. `Chauffage Salon` ou `Ventilation VMC`.
   - **Entité d'entrée (Source) :** Capteur fournissant la valeur $X$ (ex. `sensor.outdoor_temperature`).
   - **Entité de consigne (Cible) :** Entité recevant la consigne calculée $Y$ (ex. `input_number.consigne_eau_chaude` ou `climate.pompe_a_chaleur`).
   - **Mode de déclenchement :**
     - *À chaque changement d'état de l'entrée* (State Listener réactif immédiat).
     - *Périodique* (évaluation à intervalle régulier, ex. toutes les 300 s).
   - **Nombre de décimales :** Arrondi souhaité (ex. `1` pour `32.4`).

---

## 📊 Carte Lovelace Interactive (`curve-controller-card`)

La carte frontend est automatiquement enregistrée par l'intégration via le chemin statique `/curve_controller_frontend/curve-controller-card.js`.

### Vérification de la Ressource Lovelace
Si votre tableau de bord est en mode YAML ou si vous souhaitez ajouter manuellement la ressource :
- Rendez-vous dans **Paramètres** > **Tableaux de bord** > Menu 3 points > **Ressources**.
- Ajoutez une ressource :
  - **URL :** `/curve_controller_frontend/curve-controller-card.js`
  - **Type :** Module JavaScript

### Exemple d'ajout sur votre Tableau de Bord Lovelace

#### Mode Interface (UI Visuelle)
1. Modifiez votre tableau de bord Lovelace.
2. Cliquez sur **Ajouter une carte** et sélectionnez **Curve Controller Card**.
3. Configurez visuellement la carte via les options disponibles :
   - **Entité :** Sélection de l'entité `sensor.curve_controller_*` dans la liste déroulante.
   - **Titre :** Personnalisation du titre de la carte.
   - **Couleur de la courbe :** Code couleur hexadécimal (défaut : `#03a9f4`).
   - **Couleur du marqueur :** Code couleur hexadécimal (défaut : `#ff9800`).
   - **Interrupteurs d'affichage :**
     - *Bouton On/Off de régulation* (en-tête).
     - *Éditeur et tableau des points* (masquable pour une vue consultation seule).
     - *Surface sous la courbe* (dégradé SVG).
     - *Grille cartésienne*.
     - *Étiquettes de valeurs en direct sur les axes*.
     - *Marqueur dynamique temps réel*.

#### Configuration YAML (Optionnelle)

```yaml
type: custom:curve-controller-card
entity: sensor.curve_controller_calculated_output
title: "Loi d'eau - Chauffage"
curve_color: "#03a9f4"
marker_color: "#ff9800"
show_regulation_toggle: true
show_points_editor: true
show_area: true
show_grid: true
show_axis_badges: true
show_marker: true
```

### Fonctionnalités de la carte :
- **Visualisation graphique :** Courbe avec dégradé fluide et points d'inflexion.
- **Position live :** Marqueur orange pulsé indiquant exactement où se trouve votre capteur actuellement.
- **Bouton « Définir active » :** Permet de tester ou d'appliquer immédiatement un profil à la régulation.
- **Éditeur dynamique :** Modifiez les chiffres $X$ et $Y$ directement dans le tableau, ajoutez ou supprimez des points et cliquez sur **💾 Sauvegarder**.

---

## 🛠️ Actions & Services Home Assistant

Les services sont entièrement révisés pour une utilisation 100 % graphique, intuitive et native dans Home Assistant (**Outils de développement > Actions** ou éditeur visuel d'automatisations).

### 🎯 Sélection des Cibles Restreinte et Multi-Entités
- **Filtrage automatique :** Dans l'interface graphique, la sélection d'entités est automatiquement restreinte aux entités fournies par **Curve Controller** (aucun risque de sélectionner un capteur ou interrupteur tiers par erreur).
- **Multi-sélection & Cibles groupées :** Vous pouvez sélectionner une ou **plusieurs entités en même temps** (ou un appareil / une zone).
- **Adaptation & Détection des courbes communes :** Lors d'un ciblage multi-entités, l'action vérifie la présence de la courbe sur chaque contrôleur. Si la courbe n'est pas commune à toutes les entités sélectionnées, un message explicite liste les entités manquantes et rappelle toutes les courbes communes disponibles.
- **Listes déroulantes dynamiques :** Les champs de sélection de courbe proposent directement un menu déroulant contenant les courbes existantes tout en autorisant la saisie libre.

---

### 1. `curve_controller.select_curve`
Bascule la courbe active pour une ou plusieurs entités Curve Controller.

```yaml
action: curve_controller.select_curve
target:
  entity_id:
    - select.chauffage_salon_active_curve
    - select.chauffage_chambre_active_curve
data:
  curve_name: "Nuit"
```

### 2. `curve_controller.save_curve`
Crée ou met à jour les coordonnées d'une courbe (points X, Y). Synchronise instantanément la courbe sur toutes les entités ciblées.

```yaml
action: curve_controller.save_curve
target:
  entity_id: select.chauffage_salon_active_curve
data:
  curve_name: "Grand Froid"
  points:
    - [-20, 60]
    - [-10, 52]
    - [0, 44]
    - [15, 25]
  set_active: true
```
*Note : Le champ `points` accepte indifféremment des listes YAML `[[X, Y], ...]`, du JSON, ou une simple chaîne de texte (ex. `"-20: 60, -10: 52, 0: 44, 15: 25"`).*

### 3. `curve_controller.delete_curve`
Supprime un profil de courbe existant sur les entités ciblées.

```yaml
action: curve_controller.delete_curve
target:
  entity_id: select.chauffage_salon_active_curve
data:
  curve_name: "Ancienne Courbe"
```

### 4. `curve_controller.evaluate`
Force l'évaluation et l'application immédiate de la consigne cible sur les entités sélectionnées.

```yaml
action: curve_controller.evaluate
target:
  entity_id: sensor.chauffage_salon_calculated_output
```

### 5. `curve_controller.set_regulation`
Active ou met en pause l'asservissement vers l'entité de consigne cible.

```yaml
action: curve_controller.set_regulation
target:
  entity_id: switch.chauffage_salon_regulation
data:
  enabled: false
```

### 6. `curve_controller.adjust_curve_offset`
Ajuste le confort en décalant verticalement de +/- X unités (ex. +1.5 °C ou -2 °C) tous les points Y d'une courbe (ou de la courbe actuellement active si non spécifié) sur toutes les entités sélectionnées.

```yaml
action: curve_controller.adjust_curve_offset
target:
  entity_id:
    - select.chauffage_salon_active_curve
    - select.chauffage_chambre_active_curve
data:
  offset: 1.5
```

### 7. `curve_controller.copy_curve`
Duplique une courbe depuis une entité Curve Controller source vers une ou plusieurs entités cibles.

```yaml
action: curve_controller.copy_curve
target:
  entity_id: select.chauffage_chambre_active_curve
data:
  source_entity: select.chauffage_salon_active_curve
  curve_name: "Hiver"
  set_active: true
```

### 8. `curve_controller.reset_curves`
Rétablit les profils d'usine par défaut (*Hiver*, *Été*, *Nuit*, *Absent*) sur les entités sélectionnées.

```yaml
action: curve_controller.reset_curves
target:
  entity_id: select.chauffage_salon_active_curve
data:
  confirm: true
```

---

## 💡 Exemples d'Automatisations

### Passage automatique en profil "Nuit" à 22h30

```yaml
alias: "Chauffage - Bascule profil Nuit"
trigger:
  - platform: time
    at: "22:30:00"
action:
  - service: curve_controller.select_curve
    target:
      entity_id: select.curve_controller_active_curve
    data:
      curve_name: "Nuit"
```

### Passage en profil "Absent" lors du départ du domicile

```yaml
alias: "Chauffage - Mode Absent"
trigger:
  - platform: state
    entity_id: zone.home
    to: "0"
action:
  - service: curve_controller.select_curve
    target:
      entity_id: select.curve_controller_active_curve
    data:
      curve_name: "Absent"
```

---

## 📄 Licence

Ce projet est sous licence MIT. Libre à vous de l'utiliser, le modifier et le distribuer dans vos installations domotiques.

