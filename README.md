# Curve Controller pour Home Assistant

[![HACS Badge](https://img.shields.io/badge/HACS-Custom-orange.svg?style=for-the-badge)](https://github.com/hacs/default)
[![GitHub Release](https://img.shields.io/github/v/release/pyrie/ha-curve-controller?style=for-the-badge&color=blue)](https://github.com/pyrie/ha-curve-controller/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg?style=for-the-badge)](LICENSE)

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=pyrie&repository=ha-curve-controller&category=integration)

**Curve Controller** est une intégration Home Assistant personnalisée (custom integration) prête pour HACS avec sa carte Lovelace interactive dédiée. Elle permet de relier dynamiquement une **entité source** (ex. température extérieure, humidité, qualité de l'air) à une **entité cible** (consigne de chauffage, vitesse de VMC, position de volet, etc.) en appliquant une **courbe point par point** avec interpolation linéaire par morceaux et clamping automatique.

---

## ✨ Fonctionnalités Principales

- **Multi-courbes personnalisées :** Définissez plusieurs profils pour un même contrôleur (ex. *Hiver*, *Été*, *Nuit*, *Absent*, *Confort*).
- **Interpolation Linéaire par Morceaux & Paliers :** Calcul mathématique exact entre chaque point consécutif, respect parfait des paliers constants ($Y_1 = Y_2$).
- **Clamping Automatique :** Si l'entrée $X$ est inférieure au premier point ou supérieure au dernier, la consigne $Y$ reste bridée respectivement à la valeur du premier ou du dernier point.
- **Carte Lovelace interactive (`curve-controller-card`) :**
  - Tracé vectoriel SVG haute résolution avec axes et repères.
  - **Marqueur dynamique temps réel :** visualisez instantanément le point de fonctionnement actuel sur la courbe avec effet de pulsation.
  - Éditeur de coordonnées : ajout, modification numérique directe et suppression de points.
  - Bascule en un clic de la courbe active en production.
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

   [![Ouvrir dans Home Assistant](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=pyrie&repository=ha-curve-controller&category=integration)

2. Ou manuellement dans HACS :
   - Ouvrez **HACS** > Menu 3 points (en haut à droite) > **Dépôts personnalisés**.
   - Collez l'URL : `https://github.com/pyrie/ha-curve-controller`.
   - Catégorie : **Intégration**.
   - Cliquez sur **Ajouter**, puis recherchez **Curve Controller** et cliquez sur **Télécharger**.
3. Redémarrez Home Assistant.

### Méthode 2 : Installation Manuelle

1. Téléchargez la dernière archive depuis la page [Releases](https://github.com/pyrie/ha-curve-controller/releases).
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

#### Mode Interface (UI)
1. Modifiez votre tableau de bord Lovelace.
2. Cliquez sur **Ajouter une carte** et choisissez **Curve Controller Card** (ou ajoutez une carte **Manuel**).

#### Configuration YAML

```yaml
type: custom:curve-controller-card
title: "Loi d'eau - Chauffage"
entity: sensor.curve_controller_calculated_output
```

### Fonctionnalités de la carte :
- **Visualisation graphique :** Courbe avec dégradé fluide et points d'inflexion.
- **Position live :** Marqueur orange pulsé indiquant exactement où se trouve votre capteur actuellement.
- **Bouton « Définir active » :** Permet de tester ou d'appliquer immédiatement un profil à la régulation.
- **Éditeur dynamique :** Modifiez les chiffres $X$ et $Y$ directement dans le tableau, ajoutez ou supprimez des points et cliquez sur **💾 Sauvegarder**.

---

## 🛠️ Services Home Assistant

L'intégration expose 4 services sous le domaine `curve_controller` :

### 1. `curve_controller.select_curve`
Bascule la courbe active en production.

```yaml
service: curve_controller.select_curve
data:
  entity_id: sensor.curve_controller_calculated_output
  curve_name: "Nuit"
```

### 2. `curve_controller.save_curve`
Crée ou met à jour la liste des points d'une courbe.

```yaml
service: curve_controller.save_curve
data:
  entity_id: sensor.curve_controller_calculated_output
  curve_name: "Grand Froid"
  points:
    - [-20, 60]
    - [-10, 52]
    - [0, 44]
    - [15, 25]
  set_active: true
```

### 3. `curve_controller.delete_curve`
Supprime un profil de courbe existant.

```yaml
service: curve_controller.delete_curve
data:
  entity_id: sensor.curve_controller_calculated_output
  curve_name: "Ancienne Courbe"
```

### 4. `curve_controller.evaluate`
Force l'évaluation et l'application immédiate de la consigne cible.

```yaml
service: curve_controller.evaluate
data:
  entity_id: sensor.curve_controller_calculated_output
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

