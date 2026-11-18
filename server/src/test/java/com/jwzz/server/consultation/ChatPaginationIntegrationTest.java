package com.jwzz.server.consultation;

import static org.junit.jupiter.api.Assertions.*;
import com.jwzz.server.auth.*;
import com.jwzz.server.common.*;
import com.jwzz.server.report.ReportStore;
import com.jwzz.server.shop.*;
import com.jwzz.server.merchant.MerchantStore;
import java.time.LocalDateTime;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

class ChatPaginationIntegrationTest {
    @Test void bothDomainsKeepHistoryIncrementalCursorsAndReadBoundaries() {
        String url = System.getenv("JWZZ_IT_DB_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank());
        var ds = new DriverManagerDataSource(url, System.getenv("DB_USER"), System.getenv("DB_PASSWORD"));
        var jdbc = new JdbcTemplate(ds);
        new TransactionTemplate(new DataSourceTransactionManager(ds)).executeWithoutResult(status -> {
            status.setRollbackOnly(); // Every synthetic fixture is discarded, including on assertion failure.
            var users = new UserStore(jdbc);
            String suffix = UUID.randomUUID().toString();
            for (String role : List.of("USER", "DOCTOR", "MERCHANT")) users.create(role + suffix + "@example.invalid", "test-only", role);
            long user = users.findByEmail("USER" + suffix + "@example.invalid").orElseThrow().id();
            long doctor = users.findByEmail("DOCTOR" + suffix + "@example.invalid").orElseThrow().id();
            long merchant = users.findByEmail("MERCHANT" + suffix + "@example.invalid").orElseThrow().id();
            var reports = new ReportStore(jdbc);
            long report = reports.saveGenerated(user, suffix, "test", "{}").id();
            reports.grant(report, doctor);
            var consultations = new ConsultationStore(jdbc);
            var messages = new MessageStore(jdbc);
            var doctors = new DoctorDirectoryStore(jdbc);
            doctors.upsert(doctor, "测试医生", "GENERAL");
            var controller = new MessageController(users, doctors, consultations, messages, reports, new RequestRateLimiter(null, false), org.mockito.Mockito.mock(com.jwzz.server.notification.NotificationOutbox.class));
            long chat = consultations.create(report, user, doctor, "test").id();
            assertTrue(consultations.claim(chat, doctor));
            var ids = new ArrayList<Long>();
            for (int i=0; i<620; i++) ids.add(messages.add(chat, user, "record-" + i).id());
            var latest = messages.page(chat, null, null, 50);
            assertTrue(latest.hasMore());
            assertEquals(ids.subList(570, 620), latest.items().stream().map(MessageStore.Message::id).toList());
            var history = new HashSet<Long>();
            Long before = null;
            do {
                var page = messages.page(chat, before, null, 37);
                for (var message : page.items()) assertTrue(history.add(message.id()), "history repeated");
                if (!page.hasMore()) break;
                before = page.items().get(0).id();
            } while (true);
            assertEquals(new HashSet<>(ids), history);
            long seen = ids.get(619);
            var added = new ArrayList<Long>();
            for(int i=0;i<125;i++) added.add(messages.add(chat,user,"new-" + i).id());
            messages.markRead(chat, true, seen);
            assertEquals(125, messages.unread(chat, doctor, true));
            messages.markRead(chat, true, ids.get(0)); // Delayed receipt must not move backwards.
            assertEquals(125, messages.unread(chat, doctor, true));
            long after = seen;
            var fetched = new ArrayList<Long>();
            do {
                var page = messages.page(chat, null, after, 50);
                for(var message:page.items()) fetched.add(message.id());
                if (!page.hasMore()) break;
                after = page.items().get(page.items().size()-1).id();
            } while(true);
            assertEquals(added, fetched);
            assertEquals(50, messages.page(chat, null, seen, 50).items().size(), "retry returns same page");
            long otherChat = consultations.create(report,user,doctor,"other").id();
            long foreignId = messages.add(otherChat,user,"foreign").id();
            assertThrows(ResponseStatusException.class, () -> messages.markRead(chat,true,foreignId));
            assertThrows(ResponseStatusException.class, () -> messages.page(chat,seen,seen,50));
            assertThrows(ResponseStatusException.class, () -> messages.page(chat,null,null,101));
            for(int i=0;i<105;i++) consultations.create(report,user,doctor,"list-" + i);
            var conversations = new HashSet<Long>();
            before=null;
            do {
                var page=consultations.chatPage(user,false,before,20);
                for(var item:page.items()) assertTrue(conversations.add(item.id()));
                if(!page.hasMore()) break;
                before=page.items().get(page.items().size()-1).id();
            } while(true);
            assertEquals(107,conversations.size());
            assertEquals(1,consultations.chatPage(doctor,true,null,20).items().size());
            reports.revoke(report,doctor);
            assertTrue(consultations.chatPage(doctor,true,null,20).items().isEmpty());
            assertThrows(ResponseStatusException.class, () -> controller.conversation(chat, () -> "DOCTOR"+suffix+"@example.invalid", null,null,50));

            var store = new MerchantStore(jdbc).create(merchant,"Test store","","City","Address").id();
            var orders = new OrderStore(jdbc);
            var shop = new ShopConversationStore(jdbc);
            long order = orders.create(user,store,suffix,100,LocalDateTime.now().plusMinutes(15));
            long shopId = shop.create(order,user,store);
            var shopIds = new ArrayList<Long>();
            for(int i=0;i<620;i++) shopIds.add(shop.addMessage(shopId,user,"shop-" + i).id());
            assertEquals(shopIds.subList(570,620),shop.messagePage(shopId,null,null,50).items().stream().map(ShopConversationStore.Message::id).toList());
            var allShop = new HashSet<Long>();
            before=null;
            do {
                var page=shop.messagePage(shopId,before,null,43);
                for(var message:page.items()) assertTrue(allShop.add(message.id()));
                if(!page.hasMore()) break;
                before=page.items().get(0).id();
            } while(true);
            assertEquals(new HashSet<>(shopIds),allShop);
            long newShopId = shop.addMessage(shopId,user,"not read yet").id();
            shop.markRead(shopId,true,shopIds.get(619));
            shop.markRead(shopId,true,shopIds.get(0));
            assertEquals(1,shop.summary(merchant,true,shopId).orElseThrow().unreadCount());
            assertEquals(newShopId,shop.messagePage(shopId,null,shopIds.get(619),50).items().get(0).id());
            for(int i=0;i<105;i++) shop.create(orders.create(user,store,suffix+i,100,LocalDateTime.now().plusMinutes(15)),user,store);
            var shopChats=new HashSet<Long>(); before=null;
            do {
                var page=shop.page(merchant,true,before,20);
                for(var item:page.items()) assertTrue(shopChats.add(item.id()));
                if(!page.hasMore()) break;
                before=page.items().get(page.items().size()-1).id();
            } while(true);
            assertEquals(106,shopChats.size());
            assertTrue(shop.page(doctor,false,null,20).items().isEmpty());
            var service = new ShopConversationService(orders,shop,new RequestRateLimiter(null,false));
            assertThrows(ResponseStatusException.class, () -> service.detail(doctor,false,shopId,null,null,50));
            assertThrows(ResponseStatusException.class, () -> shop.messagePage(shopId,-1L,null,50));
        });
    }
}
