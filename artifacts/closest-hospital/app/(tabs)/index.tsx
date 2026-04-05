import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { HospitalCard } from "@/components/HospitalCard";
import { MapSection } from "@/components/MapSection";
import { NavigationSheet } from "@/components/NavigationSheet";
import { EmptyState } from "@/components/EmptyState";
import { LiveStatusBanner } from "@/components/LiveStatusBanner";
import { CategoryFilter } from "@/components/CategoryFilter";
import { useHospital } from "@/context/HospitalContext";
import { Hospital } from "@/types/hospital";

const MAP_HEIGHT = 220;

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    location,
    locationError,
    locationPermission,
    serverError,
    filteredHospitals,
    selectedFilter,
    availableFilters,
    isLoading,
    isRefreshing,
    requestLocationPermission,
    refresh,
    setFilter,
  } = useHospital();

  const [selectedHospital, setSelectedHospital] = useState<Hospital | null>(null);
  const [navSheetVisible, setNavSheetVisible] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState(30);

  useEffect(() => {
    if (!isLoading && !location) {
      requestLocationPermission();
    }
  }, []);

  useEffect(() => {
    if (!serverError) {
      setRetryCountdown(30);
      return;
    }
    setRetryCountdown(30);
    const interval = setInterval(() => {
      setRetryCountdown((c) => {
        if (c <= 1) {
          refresh();
          return 30;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [serverError, refresh]);

  const handleHospitalPress = useCallback((hospital: Hospital) => {
    setSelectedHospital(hospital);
    setNavSheetVisible(true);
  }, []);

  const handleCloseNavSheet = useCallback(() => {
    setNavSheetVisible(false);
  }, []);

  const headerHeight =
    Platform.OS === "web" ? 67 : 0;

  if (isLoading || isRefreshing) {
    return (
      <View
        style={[styles.centered, { backgroundColor: colors.background }]}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (serverError) {
    return (
      <View
        style={[
          styles.centered,
          {
            backgroundColor: colors.background,
            paddingTop: insets.top,
          },
        ]}
      >
        <EmptyState
          icon="wifi-slash"
          title="Server Updating"
          description={`The server is being updated. Retrying in ${retryCountdown}s...`}
          actionLabel="Retry Now"
          onAction={() => { setRetryCountdown(30); refresh(); }}
        />
      </View>
    );
  }

  if (locationError || locationPermission === "denied") {
    return (
      <View
        style={[
          styles.centered,
          {
            backgroundColor: colors.background,
            paddingTop: headerHeight + insets.top,
          },
        ]}
      >
        <EmptyState
          icon="map-marker-slash"
          title="Location Required"
          description="ER Choices needs your location to find nearby hospitals. Please grant location access to continue."
          actionLabel="Enable Location"
          onAction={async () => {
            if (Platform.OS !== "web") {
              await Linking.openSettings();
            } else {
              await requestLocationPermission();
            }
          }}
        />
        {Platform.OS === "web" && (
          <TouchableOpacity
            style={[
              styles.retryBtn,
              { backgroundColor: colors.muted, borderRadius: colors.radius },
            ]}
            onPress={requestLocationPermission}
          >
            <Text style={[styles.retryText, { color: colors.foreground }]}>
              Try Again
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const ListHeader = (
    <View>
      <View style={[styles.mapContainer, { height: MAP_HEIGHT }]}>
        <MapSection
          latitude={location?.latitude ?? null}
          longitude={location?.longitude ?? null}
          hospitals={filteredHospitals}
          onHospitalPress={handleHospitalPress}
        />
        <TouchableOpacity
          style={[
            styles.refreshBtn,
            { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius - 4 },
          ]}
          onPress={refresh}
          activeOpacity={0.8}
        >
          <MaterialIcons name="my-location" size={18} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <LiveStatusBanner />

      {availableFilters.length > 1 && (
        <CategoryFilter
          selected={selectedFilter}
          onSelect={setFilter}
          availableFilters={availableFilters}
        />
      )}
    </View>
  );

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: Platform.OS === "web" ? headerHeight : 0 },
      ]}
    >
      {filteredHospitals.length === 0 && !isLoading && location ? (
        <FlatList
          data={[]}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={
            <EmptyState
              icon="hospital"
              title="No Hospitals Found"
              description="We couldn't find any emergency rooms near your location."
            />
          }
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={refresh}
              tintColor={colors.primary}
            />
          }
          keyExtractor={() => "empty"}
          renderItem={() => null}
        />
      ) : (
        <FlatList
          data={filteredHospitals}
          ListHeaderComponent={ListHeader}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => (
            <HospitalCard
              hospital={item}
              index={index}
              onPress={handleHospitalPress}
            />
          )}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 80) },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={refresh}
              tintColor={colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      <NavigationSheet
        hospital={selectedHospital}
        visible={navSheetVisible}
        onClose={handleCloseNavSheet}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    padding: 24,
  },
  mapContainer: {
    width: "100%",
    position: "relative",
  },
  refreshBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  listContent: {
    paddingTop: 4,
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 8,
  },
  retryText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
});
