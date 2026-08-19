import { useCallback, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useBrand } from "@/context/BrandContext";
import { Button } from "@/components/Button";
import { Card, ScreenHeader, SectionLabel } from "@/components/ui";
import { CropMarks } from "@/components/StockPane";
import { EmptyStock } from "@/components/EmptyStock";
import { Icon } from "@/components/Icon";
import { PaperSubstrate } from "@/components/PaperSubstrate";
import {
  listClientProjects,
  removeClientProject,
  saveClientProject,
  type ClientProject,
  type ReviewStatus,
} from "@/lib/clientProjects";
import { getLibrary, type LibraryDesign } from "@/lib/designLibrary";
import { RADIUS, SPACE, TYPE } from "@/lib/theme";

const STATUS: { id: ReviewStatus; label: string }[] = [
  { id: "draft", label: "Draft" },
  { id: "sent", label: "In review" },
  { id: "changes", label: "Changes" },
  { id: "approved", label: "Approved" },
];

export default function ProjectsScreen() {
  const { brand, theme } = useBrand();
  const [projects, setProjects] = useState<ClientProject[]>([]);
  const [designs, setDesigns] = useState<LibraryDesign[]>([]);
  const [editing, setEditing] = useState<ClientProject | null>(null);
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [placement, setPlacement] = useState("");
  const [notes, setNotes] = useState("");
  const [designIds, setDesignIds] = useState<string[]>([]);

  const refresh = useCallback(
    () =>
      Promise.all([listClientProjects(brand.id), getLibrary(brand.id)]).then(
        ([nextProjects, nextDesigns]) => {
          setProjects(nextProjects);
          setDesigns(nextDesigns);
        },
      ),
    [brand.id],
  );

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  function begin(project?: ClientProject) {
    setEditing(project ?? ({ id: "", status: "draft" } as ClientProject));
    setName(project?.name ?? "");
    setClient(project?.client ?? "");
    setPlacement(project?.placement ?? "");
    setNotes(project?.notes ?? "");
    setDesignIds(project?.designIds ?? []);
  }

  async function save() {
    if (!name.trim()) {
      Alert.alert(
        "Project name needed",
        "Give this client project a clear name first.",
      );
      return;
    }
    await saveClientProject(brand.id, {
      ...(editing?.id ? editing : {}),
      name,
      client,
      placement,
      notes,
      designIds,
    });
    setEditing(null);
    await refresh();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  async function changeStatus(project: ClientProject, status: ReviewStatus) {
    await saveClientProject(brand.id, {
      ...project,
      name: project.name,
      status,
    });
    await refresh();
  }

  function toggleDesign(design: LibraryDesign) {
    const selected = designIds.includes(design.id);
    setDesignIds((ids) =>
      selected ? ids.filter((id) => id !== design.id) : [...ids, design.id],
    );
  }

  function confirmDelete(project: ClientProject) {
    Alert.alert("Delete project?", project.name, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await removeClientProject(brand.id, project.id);
          await refresh();
        },
      },
    ]);
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.scroll}
    >
      <ScreenHeader
        eyebrow="Client workspace"
        title="Projects & approvals"
        subtitle="Keep every concept, placement note, revision, and client decision together."
      />
      <Button
        label="New client project"
        icon="add"
        variant="primary"
        onPress={() => begin()}
      />

      {editing && (
        <Card style={styles.editor}>
          <Field
            label="PROJECT"
            value={name}
            onChange={setName}
            placeholder="Botanical half sleeve"
          />
          <Field
            label="CLIENT"
            value={client}
            onChange={setClient}
            placeholder="Client name"
          />
          <Field
            label="PLACEMENT"
            value={placement}
            onChange={setPlacement}
            placeholder="Outer forearm · 7 in"
          />
          <Field
            label="NOTES"
            value={notes}
            onChange={setNotes}
            placeholder="Creative direction, revision notes, appointment details…"
            multiline
          />

          {!!designs.length && (
            <>
              <Text
                style={[
                  styles.fieldLabel,
                  { color: theme.muted, fontFamily: theme.fontBodyMedium },
                ]}
              >
                PROJECT ARTWORK
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.designRow}
              >
                {designs.map((design, index) => {
                  const selected = designIds.includes(design.id);
                  return (
                    <Pressable
                      key={design.id}
                      onPress={() => toggleDesign(design)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={`Attach ${design.title}`}
                      style={[
                        styles.design,
                        {
                          backgroundColor: theme.stock,
                          borderColor: selected ? theme.accent : theme.line,
                        },
                      ]}
                    >
                      <PaperSubstrate seed={index + 240} />
                      <CropMarks color={theme.stockMark} />
                      <Image
                        source={{ uri: design.uri }}
                        style={styles.designImage}
                        contentFit="contain"
                      />
                      <View
                        style={[
                          styles.designCheck,
                          {
                            backgroundColor: selected
                              ? theme.accent
                              : `${theme.stock}e8`,
                          },
                        ]}
                      >
                        <Icon
                          name={selected ? "checkmark" : "add"}
                          size={TYPE.caption.fontSize}
                          color={selected ? theme.accentText : theme.stockInk}
                        />
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          )}

          <View style={styles.actions}>
            <Button
              label="Cancel"
              icon="close"
              onPress={() => setEditing(null)}
              style={styles.flex}
            />
            <Button
              label="Save project"
              icon="checkmark"
              variant="primary"
              onPress={save}
              style={styles.flex}
            />
          </View>
        </Card>
      )}

      <View style={styles.listHeader}>
        <SectionLabel>
          {projects.length ? "Active work" : "Project workspace"}
        </SectionLabel>
      </View>
      <View style={styles.projectList}>
        {projects.length ? (
          projects.map((project) => (
            <Pressable
              key={project.id}
              onPress={() => begin(project)}
              onLongPress={() => confirmDelete(project)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${project.name}`}
              accessibilityHint="Long press to delete this project"
              style={[
                styles.project,
                { backgroundColor: theme.surface, borderColor: theme.line },
              ]}
            >
              <View
                style={[
                  styles.projectIcon,
                  { backgroundColor: `${theme.accent}18` },
                ]}
              >
                <Icon
                  name="projects"
                  size={SPACE.lg - SPACE.xs}
                  color={theme.accent}
                />
              </View>
              <View style={styles.flex}>
                <Text
                  style={[
                    styles.projectName,
                    {
                      color: theme.foreground,
                      fontFamily: theme.fontBodyMedium,
                    },
                  ]}
                >
                  {project.name}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.projectDetail,
                    { color: theme.muted, fontFamily: theme.fontBody },
                  ]}
                >
                  {[project.client, project.placement]
                    .filter(Boolean)
                    .join(" · ") || "Add client and placement details"}
                </Text>
                <Text
                  style={[
                    styles.projectCount,
                    { color: theme.muted, fontFamily: theme.fontBody },
                  ]}
                >
                  {project.designIds.length} attached design
                  {project.designIds.length === 1 ? "" : "s"}
                </Text>
                <View style={styles.statusRow} accessibilityRole="radiogroup">
                  {STATUS.map((item) => {
                    const active = project.status === item.id;
                    return (
                      <Pressable
                        key={item.id}
                        onPress={() => changeStatus(project, item.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`${project.name}: ${item.label}`}
                        style={[
                          styles.status,
                          {
                            borderColor: active ? theme.accent : theme.line,
                            backgroundColor: active
                              ? `${theme.accent}18`
                              : theme.surfaceAlt,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusLabel,
                            {
                              color: active ? theme.accent : theme.muted,
                              fontFamily: theme.fontBodyMedium,
                            },
                          ]}
                        >
                          {item.label.toUpperCase()}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <Icon
                name="chevronForward"
                size={SPACE.md + SPACE.xs}
                color={theme.muted}
              />
            </Pressable>
          ))
        ) : (
          <EmptyStock
            icon="projects"
            title="No client projects"
            detail="Create a project for each client. Approval state and revision notes stay private on this device until explicitly shared."
            action={{ label: "New client project", onPress: () => begin() }}
          />
        )}
      </View>
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  const { theme } = useBrand();
  return (
    <View style={styles.fieldWrap}>
      <Text
        style={[
          styles.fieldLabel,
          { color: theme.muted, fontFamily: theme.fontBodyMedium },
        ]}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        multiline={multiline}
        style={[
          styles.input,
          multiline && styles.multilineInput,
          {
            color: theme.foreground,
            backgroundColor: theme.surfaceAlt,
            borderColor: theme.line,
            fontFamily: theme.fontBody,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: SPACE.md, paddingTop: SPACE.lg, paddingBottom: SPACE.xxl },
  flex: { flex: 1 },
  editor: { marginTop: SPACE.md },
  fieldWrap: { marginBottom: SPACE.sm },
  fieldLabel: { ...TYPE.micro, marginBottom: SPACE.xs - 1 },
  input: {
    ...TYPE.body,
    minHeight: SPACE.xxl + 2,
    borderWidth: 1,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACE.md - SPACE.xs + 2,
    paddingVertical: SPACE.sm,
  },
  multilineInput: {
    minHeight: SPACE.xxl * 2 - SPACE.sm,
    textAlignVertical: "top",
  },
  actions: { flexDirection: "row", gap: SPACE.sm, marginTop: SPACE.xs },
  listHeader: { marginTop: SPACE.xl },
  projectList: { gap: SPACE.sm },
  project: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACE.md - SPACE.xs + 2,
    flexDirection: "row",
    gap: SPACE.sm,
    alignItems: "flex-start",
  },
  projectIcon: {
    width: SPACE.xxl - SPACE.xs + 4,
    height: SPACE.xxl - SPACE.xs + 4,
    borderRadius: RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
  },
  projectName: { ...TYPE.body },
  projectDetail: { ...TYPE.caption },
  projectCount: { ...TYPE.micro, marginTop: SPACE.xs - 3 },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACE.xs - 1,
    marginTop: SPACE.sm - 1,
  },
  status: {
    borderWidth: 1,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACE.sm - 3,
    paddingVertical: SPACE.xs - 2,
  },
  statusLabel: { ...TYPE.micro },
  designRow: { gap: SPACE.sm - 3, paddingBottom: SPACE.sm },
  design: {
    width: SPACE.xxl + SPACE.xl + SPACE.xs,
    height: SPACE.xxl + SPACE.xl + SPACE.xs,
    borderWidth: 2,
    borderRadius: RADIUS.sm,
    overflow: "hidden",
  },
  designImage: { width: "100%", height: "100%" },
  designCheck: {
    position: "absolute",
    right: SPACE.xs - 2,
    top: SPACE.xs - 2,
    width: SPACE.md + SPACE.xs - 3,
    height: SPACE.md + SPACE.xs - 3,
    borderRadius: RADIUS.pill,
    alignItems: "center",
    justifyContent: "center",
  },
});
