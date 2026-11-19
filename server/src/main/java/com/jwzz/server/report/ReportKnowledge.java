package com.jwzz.server.report;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.text.Normalizer;
import java.util.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/** Local source-checked summaries only. Retrieval never receives the report or calls a model. */
@Component
public class ReportKnowledge {
    private static final Set<String> SOURCE_HOSTS = Set.of("www.cdc.gov", "www.heart.org", "www.nia.nih.gov");
    record Passage(String text, String publisher, String title, String section, String url) {}
    record Entry(String id, String status, String title, List<String> aliases, List<Passage> passages) {}
    record Catalog(String version, List<Entry> entries) {}
    public record Topic(String id, String question) {}
    public record Answer(String status, String corpusVersion, Topic topic, List<Passage> passages, String notice) {}
    private final String version;
    private final Map<String, Entry> index;
    private final List<Topic> topics;

    @Autowired
    public ReportKnowledge(ObjectMapper mapper) throws IOException {
        this(readCatalog(mapper));
    }

    private static Catalog readCatalog(ObjectMapper mapper) throws IOException {
        try (var input = new ClassPathResource("knowledge/bp-basics.json").getInputStream()) {
            return mapper.readValue(input, Catalog.class);
        }
    }

    ReportKnowledge(Catalog catalog) {
        if (!hasText(catalog.version()) || catalog.entries() == null) throw new IllegalStateException("Invalid knowledge catalog");
        version = catalog.version();
        var ids = new HashSet<String>();
        var choices = new ArrayList<Topic>();
        var approved = new HashMap<String, Entry>();
        for (Entry entry : catalog.entries()) {
            if (entry == null || !hasText(entry.id()) || !ids.add(entry.id())
                || entry.status() == null || !Set.of("SOURCE_CHECKED", "DRAFT", "RETIRED").contains(entry.status()))
                throw new IllegalStateException("Invalid or duplicate knowledge entry");
            if (!"SOURCE_CHECKED".equals(entry.status())) continue;
            if (!hasText(entry.title()) || entry.aliases() == null || entry.passages() == null || entry.passages().isEmpty()
                || !entry.passages().stream().allMatch(ReportKnowledge::validPassage))
                throw new IllegalStateException("Missing source evidence: " + entry.id());
            var queries = new ArrayList<>(entry.aliases());
            queries.add(entry.title());
            for (String query : queries) {
                if (!hasText(query) || query.length() > 200 || normalize(query).isEmpty())
                    throw new IllegalStateException("Invalid knowledge alias: " + entry.id());
                Entry previous = approved.putIfAbsent(normalize(query), entry);
                if (previous != null && previous != entry) throw new IllegalStateException("Ambiguous knowledge alias");
            }
            choices.add(new Topic(entry.id(), entry.title()));
        }
        index = Map.copyOf(approved);
        topics = List.copyOf(choices);
    }

    public List<Topic> topics() { return topics; }

    public Answer answer(String question) {
        Entry entry = index.get(normalize(question));
        if (entry == null) return new Answer("INSUFFICIENT_EVIDENCE", version, null, List.of(),
            "目前资料没有覆盖这个问法。可以试试上面的常见问题；如需解读个人数值、症状或用药，请咨询专业人员。");
        return new Answer("ANSWERED", version, new Topic(entry.id(), entry.title()), List.copyOf(entry.passages()),
            "这是一般知识，不判断这份报告的数值、能否直接比较或个人病情。");
    }

    static String normalize(String text) {
        return Normalizer.normalize(text, Normalizer.Form.NFKC).strip()
            .replaceFirst("[?。.!！]+$", "").strip();
    }

    private static boolean hasText(String value) { return value != null && !value.isBlank(); }

    private static boolean validPassage(Passage passage) {
        if (passage == null || !hasText(passage.text()) || !hasText(passage.publisher()) || !hasText(passage.title())
            || !hasText(passage.section()) || !hasText(passage.url())) return false;
        try {
            URI uri = URI.create(passage.url());
            return "https".equals(uri.getScheme()) && uri.getUserInfo() == null && uri.getPort() == -1
                && uri.getHost() != null && SOURCE_HOSTS.contains(uri.getHost());
        } catch (IllegalArgumentException invalidUrl) { return false; }
    }
}
