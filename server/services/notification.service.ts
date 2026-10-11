import { db } from '../db/database.ts';
import type { 
  Notification, 
  NotificationChannel, 
  NotificationRule, 
  NotificationEvent, 
  NotificationEventType 
} from '../db/schema.ts';
import { AuditService } from './audit.service.ts';
import { openDebtLots, lotAge, ledgerByCustomer } from './debt-aging.ts';
import { businessToday } from '../utils/date.ts';
import { escapeHtml } from './telegram.service.ts';

export class NotificationService {
  /**
   * Dispatches an event and queues notifications across active channels matching rules
   */
  public static dispatchEvent(
    company_id: string,
    event_type: NotificationEventType,
    title: string,
    message: string,
    data: Record<string, any> = {},
    agent_id?: string | null,
    customer_id?: string | null
  ): NotificationEvent {
    const eventId = `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    const eventRecord: NotificationEvent = {
      id: eventId,
      company_id,
      event_type,
      title,
      message,
      data,
      agent_id: agent_id || null,
      customer_id: customer_id || null,
      created_at: now
    };

    db.insert('notification_events', eventRecord);

    // Find rules for this event_type in company
    const rules = db.find('notification_rules', r => r.company_id === company_id && r.event_type === event_type && r.is_active);
    const activeChannels = db.find('notification_channels', c => c.company_id === company_id && c.is_active);
    const channelMap = new Map(activeChannels.map(c => [c.id, c]));

    for (const rule of rules) {
      const channel = channelMap.get(rule.channel_id);
      if (channel) {
        this.queueNotification({
          company_id,
          event_id: eventId,
          channel_id: channel.id,
          channel_type: channel.channel_type,
          title,
          content: message,
          recipient: channel.config?.chat_id || channel.config?.recipient || 'Telegram Topic'
        });
      }
    }

    return eventRecord;
  }

  /**
   * Queues an outbound notification
   */
  public static queueNotification(dto: {
    company_id: string;
    event_id?: string;
    channel_id?: string;
    channel_type: 'TELEGRAM' | 'EMAIL' | 'SMS' | 'IN_APP';
    title: string;
    content: string;
    recipient?: string;
  }): Notification {
    const notifId = `notif-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    const notif: Notification = {
      id: notifId,
      company_id: dto.company_id,
      event_id: dto.event_id || null,
      channel_id: dto.channel_id || null,
      channel_type: dto.channel_type,
      title: dto.title,
      content: dto.content,
      status: dto.channel_type === 'IN_APP' ? 'SENT' : 'PENDING',
      attempt_count: 0,
      recipient: dto.recipient,
      created_at: now,
      sent_at: dto.channel_type === 'IN_APP' ? now : null
    };

    db.insert('notifications', notif);
    return notif;
  }

  /**
   * Checks customer balance against debt threshold and triggers alert if exceeded
   */
  public static checkAndAlertCustomerDebt(customer_id: string): boolean {
    const customer = db.findById('customers', customer_id);
    if (!customer || !customer.debt_alert_threshold || customer.debt_alert_threshold <= 0) {
      return false;
    }

    const currentBal = customer.current_balance || 0;
    if (currentBal >= customer.debt_alert_threshold) {
      this.dispatchEvent(
        customer.company_id,
        'DEBT_THRESHOLD_EXCEEDED',
        `Qarzdorlik chegarasi oshdi: ${customer.name}`,
        `Mijoz ${customer.name} (Kod: ${customer.code}) qarzi ${currentBal.toLocaleString()} UZS ga yetdi. Belgilangan chegara: ${customer.debt_alert_threshold.toLocaleString()} UZS.`,
        {
          customer_id: customer.id,
          name: customer.name,
          debt: currentBal,
          threshold: customer.debt_alert_threshold
        },
        customer.agent_id,
        customer.id
      );
      return true;
    }
    return false;
  }

  /**
   * Gathers all customers with overdue debt (> 10 days or exceeding credit limit),
   * grouped by Sales Agent, formatted for Telegram Admin bot.
   */
  public static getOverdueCustomerDebtsSummary(company_id: string, minDays = 10): {
    total_overdue_debt: number;
    agents_count: number;
    customers_count: number;
    by_agent: {
      agent_id: string;
      agent_name: string;
      agent_code: string;
      total_agent_debt: number;
      customers: {
        customer_id: string;
        customer_name: string;
        customer_code: string;
        territory: string;
        debt: number;
        overdue_days: number;
        credit_limit: number;
      }[];
    }[];
    formatted_message: string;
  } {
    const customers = db.find('customers', c => c.company_id === company_id && (c.current_balance || 0) > 0);
    const territories = db.find('territories', t => t.company_id === company_id);
    const terrMap = new Map(territories.map(t => [t.id, t.name]));
    const agents = db.find('agents', a => a.company_id === company_id);
    const agentMap = new Map(agents.map(a => [a.id, a]));

    const agentBuckets = new Map<string, any>();

    let totalOverdueDebt = 0;
    let overdueCustomerCount = 0;

    const today = businessToday();
    const ledger = ledgerByCustomer(company_id);
    for (const c of customers) {
      // Age of the oldest debt that is still unpaid after payments are applied (FIFO).
      // Debt of unknown origin date is never given an invented age; it counts only via the credit limit.
      const { lots, debt } = openDebtLots(company_id, c.id, today, ledger);
      if (debt <= 0) continue;
      const ages = lots.map(l => lotAge(l, today)).filter((d): d is number => d !== null);
      const overdueDays = ages.length ? Math.max(...ages) : 0;

      const limitExceeded = c.credit_limit && c.credit_limit > 0 && debt >= c.credit_limit;
      const isOverdue = overdueDays >= minDays || limitExceeded;

      if (isOverdue) {
        overdueCustomerCount++;
        totalOverdueDebt += debt;

        const agentId = c.agent_id || 'unassigned';
        const agent = agentMap.get(agentId);
        const agentName = agent ? agent.full_name : 'Biriktirilmagan Agent';
        const agentCode = agent ? agent.code : 'AG-NONE';

        if (!agentBuckets.has(agentId)) {
          agentBuckets.set(agentId, {
            agent_id: agentId,
            agent_name: agentName,
            agent_code: agentCode,
            total_agent_debt: 0,
            customers: []
          });
        }

        const bucket = agentBuckets.get(agentId);
        bucket.total_agent_debt += debt;
        bucket.customers.push({
          customer_id: c.id,
          customer_name: c.name,
          customer_code: c.code,
          territory: terrMap.get(c.territory_id || '') || c.address || 'Hudud ko\'rsatilmagan',
          debt,
          overdue_days: overdueDays,
          credit_limit: c.credit_limit || 0
        });
      }
    }

    const byAgentList = Array.from(agentBuckets.values());
    byAgentList.sort((a, b) => b.total_agent_debt - a.total_agent_debt);

    // Format Telegram Bot text as requested:
    // "u habarda mijozning ismi teritoriyasi umumiy qarzdorligi va agenti bolishi kerak har bir agentnikini alohida alohida qilib jamlab tashlashi kerak."
    let messageLines: string[] = [];
    messageLines.push(`🚨 <b>DIQQAT: QARZDORLIK 10 KUNDAN OSHGAN MIJOZLAR HISOBOTI</b>`);
    messageLines.push(`📅 Sana: ${businessToday()}`);
    messageLines.push(`💰 Jami kechikkan qarz: <b>${totalOverdueDebt.toLocaleString()} UZS</b>`);
    messageLines.push(`👥 Xavfli mijozlar soni: <b>${overdueCustomerCount} ta</b>`);
    messageLines.push(`─────────────────────────`);

    // Names come from users and SalesDoc: escaped for Telegram HTML.
    for (const ag of byAgentList) {
      messageLines.push(`\n👤 <b>Agent: ${escapeHtml(ag.agent_name)}</b> (Kod: ${escapeHtml(ag.agent_code)})`);
      messageLines.push(`💳 Agent bo'yicha jami qarz: <b>${ag.total_agent_debt.toLocaleString()} UZS</b>`);
      for (const cust of ag.customers) {
        messageLines.push(`  • <b>${escapeHtml(cust.customer_name)}</b> (${escapeHtml(cust.customer_code)})`);
        messageLines.push(`    📍 Hudud: ${escapeHtml(cust.territory)}`);
        messageLines.push(`    💵 Qarzdorlik: ${cust.debt.toLocaleString()} UZS (Muddati: ${cust.overdue_days} kun)`);
      }
    }

    return {
      total_overdue_debt: totalOverdueDebt,
      agents_count: byAgentList.length,
      customers_count: overdueCustomerCount,
      by_agent: byAgentList,
      formatted_message: messageLines.join('\n')
    };
  }

  /**
   * Dispatches overdue debts Telegram alert to admin channel/bot
   */
  public static sendOverdueDebtsTelegramAlert(company_id: string, minDays = 10) {
    const summary = this.getOverdueCustomerDebtsSummary(company_id, minDays);
    if (summary.customers_count === 0) {
      return { success: true, message: '10 kundan oshgan qarzdorliklar topilmadi.', sent: false };
    }

    const notif = this.dispatchEvent(
      company_id,
      'DEBT_THRESHOLD_EXCEEDED',
      `🚨 Qarzdorlik >${minDays} kun hisoboti (Agentlar kesimida)`,
      summary.formatted_message,
      {
        total_overdue_debt: summary.total_overdue_debt,
        agents_count: summary.agents_count,
        customers_count: summary.customers_count
      }
    );

    return {
      success: true,
      message: db.find('notification_rules', r => r.company_id === company_id && r.event_type === 'DEBT_THRESHOLD_EXCEEDED' && r.is_active).length
        ? `${summary.customers_count} ta mijoz bo'yicha hisobot "Qarzdorlar" xabarini oladigan botlarga yuborilmoqda.`
        : `${summary.customers_count} ta mijoz bo'yicha hisobot tuzildi, lekin "Qarzdorlar" xabarini oladigan bot yo'q. Sozlamalar → Botlar bo'limida ulang.`,
      summary,
      event_id: notif.id
    };
  }

  /**
   * Lists recent notifications
   */
  public static listNotifications(company_id: string, limit = 50): Notification[] {
    const notifs = db.find('notifications', n => n.company_id === company_id);
    notifs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return notifs.slice(0, limit);
  }

  /**
   * Lists configured notification channels
   */
  public static listChannels(company_id: string): NotificationChannel[] {
    return db.find('notification_channels', c => c.company_id === company_id);
  }
}
