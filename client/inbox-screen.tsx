import { useRpc, type PluginScreenProps, type PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { ExternalLink, SidebarRow } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { Pressable, ScrollView, Text, View } from "react-native";
import { readInbox } from "../shared/inbox.ts";

function useInbox(hostId: string) {
  const read = useRpc(readInbox);
  return useQuery({
    queryKey: ["paseo-swarm-inbox", hostId],
    queryFn: () => read({}),
    refetchInterval: 4000,
  });
}

export function InboxItem({ host, theme, currentScreen, openScreen }: PluginSidebarItemProps) {
  const { data } = useInbox(host.id);
  const count = data?.length ?? 0;
  return (
    <SidebarRow
      icon="CircleAlert"
      active={currentScreen?.screenId === "inbox"}
      onPress={() => openScreen({ screenId: "inbox" })}
      trailing={count > 0 ? (
        <Text
          accessibilityLabel={`${count} items need your attention`}
          style={{ color: theme.colors.statusWarning, backgroundColor: theme.colors.surface2, fontSize: 12, fontWeight: "700", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7 }}
        >{count}</Text>
      ) : undefined}
    />
  );
}

export function InboxScreen({ host, theme, layout, navigation }: PluginScreenProps) {
  const { colors } = theme;
  const inbox = useInbox(host.id);
  const panel = { padding: 16, gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface1 } as const;

  return (
    <ScrollView style={{ backgroundColor: colors.surface0 }} contentContainerStyle={{ padding: layout.compact ? 14 : 24 }}>
      <View style={{ width: "100%", maxWidth: 760, alignSelf: "center", gap: 12 }}>
        {inbox.isError && <Text accessibilityRole="alert" style={{ color: colors.statusDanger }}>{inbox.error.message}</Text>}
        {inbox.isPending && <Text style={{ color: colors.foregroundMuted }}>Checking for decisions…</Text>}
        {inbox.isSuccess && inbox.data.length === 0 && (
          <View style={panel}>
            <Text accessibilityRole="header" style={{ color: colors.foreground, fontWeight: "700", fontSize: 18 }}>You’re caught up</Text>
            <Text style={{ color: colors.foregroundMuted }}>Paseo approvals and questions from swarm leads appear here automatically.</Text>
          </View>
        )}
        {inbox.data?.map(({ agentId, title, request }) => {
          const [question, ...lines] = request.kind === "decision" ? request.summary.split("\n") : [];
          const issue = request.kind === "decision" ? request.issue : undefined;
          return (
            <View key={`${agentId}:${request.kind}`} style={{ ...panel, borderLeftColor: colors.statusWarning, borderLeftWidth: 3 }}>
              <Text style={{ color: colors.statusWarning, fontSize: 12, fontWeight: "600" }}>
                {request.kind === "approval" ? `Paseo approval${request.count > 1 ? `s · ${request.count}` : ""}` : "Swarm decision"}
              </Text>
              <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 19, fontWeight: "700" }}>{question ?? title}</Text>
              {question && <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>{title}</Text>}
              {lines.length > 0 && <Text selectable style={{ color: colors.foregroundMuted, lineHeight: 21 }}>{lines.join("\n").trim()}</Text>}
              {issue && (
                <ExternalLink href={issue.url} accessibilityLabel={`Open ${issue.identifier} in Linear`}>
                  <Text style={{ color: colors.accent }}>{issue.identifier} ↗</Text>
                </ExternalLink>
              )}
              <Pressable
                accessibilityRole="button"
                disabled={!navigation}
                onPress={() => navigation?.openAgent({ agentId, serverId: host.id })}
                style={{ alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingHorizontal: 11, borderRadius: 7, backgroundColor: colors.accent }}
              >
                <Text style={{ color: colors.accentForeground, fontWeight: "700" }}>
                  {request.kind === "approval" ? "Open approval" : "Answer in lead chat"}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}
