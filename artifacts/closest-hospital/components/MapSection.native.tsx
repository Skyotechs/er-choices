import React, { useRef, useEffect } from "react";
import { View, StyleSheet, Platform, Text } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import Constants from "expo-constants";
import { useColors } from "@/hooks/useColors";
import { Hospital } from "@/types/hospital";

interface MapSectionProps {
  latitude: number | null;
  longitude: number | null;
  hospitals: Hospital[];
  onHospitalPress: (hospital: Hospital) => void;
}

export function MapSection({
  latitude,
  longitude,
  hospitals,
  onHospitalPress,
}: MapSectionProps) {
  const colors = useColors();
  const mapRef = useRef<MapView>(null);
  const hasAndroidMapsKey = Boolean(
    Constants.expoConfig?.android?.config?.googleMaps?.apiKey,
  );

  useEffect(() => {
    if (latitude && longitude && mapRef.current) {
      mapRef.current.animateToRegion(
        {
          latitude,
          longitude,
          latitudeDelta: 0.15,
          longitudeDelta: 0.15,
        },
        800
      );
    }
  }, [latitude, longitude]);

  if (!latitude || !longitude) {
    return (
      <View style={[styles.placeholder, { backgroundColor: colors.muted }]}>
        <Text style={[styles.placeholderText, { color: colors.mutedForeground }]}>
          Enable location to see map
        </Text>
      </View>
    );
  }

  // A standalone Android app crashes or displays a blank map when Google Maps
  // is initialized without a configured Android Maps API key. Keep the main
  // hospital list available while the key is being configured instead.
  if (Platform.OS === "android" && !hasAndroidMapsKey) {
    return (
      <View style={[styles.placeholder, { backgroundColor: colors.muted }]}>
        <Text style={[styles.placeholderText, { color: colors.mutedForeground }]}>
          Map view is temporarily unavailable
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === "android" ? "google" : PROVIDER_DEFAULT}
        initialRegion={{
          latitude,
          longitude,
          latitudeDelta: 0.15,
          longitudeDelta: 0.15,
        }}
        showsUserLocation={true}
        showsMyLocationButton={false}
        userInterfaceStyle="light"
      >
        {hospitals
          .filter(
            (h) =>
              h.latitude != null &&
              h.longitude != null &&
              isFinite(h.latitude) &&
              isFinite(h.longitude)
          )
          .map((hospital) => (
            <Marker
              key={hospital.id}
              coordinate={{
                latitude: hospital.latitude as number,
                longitude: hospital.longitude as number,
              }}
              title={hospital.name}
              description={hospital.city ? `${hospital.city}, ${hospital.state}` : hospital.state}
              pinColor={colors.mapPin}
              onCalloutPress={() => onHospitalPress(hospital)}
            />
          ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: "hidden",
  },
  placeholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  placeholderText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
});
