// src/services/classService.js
import { Types } from "mongoose";
import Room from "../models/roomModel.js";
import Class from "../models/classModel.js";
import ClassSession from "../models/classSessionModel.js";
import Enrollment from "../models/enrollmentModel.js";

// ══════════════════════════════════════════════════════
// SALONES (Rooms)
// ══════════════════════════════════════════════════════

const roomService = {
  async create(organizationId, data) {
    const room = new Room({ organizationId, ...data });
    return room.save();
  },

  async getByOrganization(organizationId) {
    return Room.find({ organizationId }).sort({ name: 1 });
  },

  async getById(id) {
    const room = await Room.findById(id);
    if (!room) throw new Error("Salón no encontrado");
    return room;
  },

  async update(id, data) {
    const room = await Room.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    if (!room) throw new Error("Salón no encontrado");
    return room;
  },

  async delete(id) {
    // Verificar que no haya sesiones futuras activas en este salón
    const futureSessions = await ClassSession.countDocuments({
      roomId: id,
      status: { $nin: ["cancelled", "completed"] },
      startDate: { $gte: new Date() },
    });
    if (futureSessions > 0) {
      throw new Error(
        `No se puede eliminar el salón porque tiene ${futureSessions} sesión(es) programada(s)`
      );
    }
    const room = await Room.findByIdAndDelete(id);
    if (!room) throw new Error("Salón no encontrado");
    return { message: "Salón eliminado exitosamente" };
  },
};

// ══════════════════════════════════════════════════════
// CLASES (tipos de clase — plantillas)
// ══════════════════════════════════════════════════════

const classTypeService = {
  async create(organizationId, data) {
    const classDoc = new Class({ organizationId, ...data });
    return classDoc.save();
  },

  async getByOrganization(organizationId, { includeInactive = false } = {}) {
    const filter = { organizationId };
    if (!includeInactive) filter.isActive = true;
    return Class.find(filter).sort({ name: 1 });
  },

  async getById(id) {
    const classDoc = await Class.findById(id);
    if (!classDoc) throw new Error("Clase no encontrada");
    return classDoc;
  },

  async update(id, data) {
    const classDoc = await Class.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    });
    if (!classDoc) throw new Error("Clase no encontrada");
    return classDoc;
  },

  async delete(id) {
    const futureSessions = await ClassSession.countDocuments({
      classId: id,
      status: { $nin: ["cancelled", "completed"] },
      startDate: { $gte: new Date() },
    });
    if (futureSessions > 0) {
      throw new Error(
        `No se puede eliminar la clase porque tiene ${futureSessions} sesión(es) programada(s)`
      );
    }
    const classDoc = await Class.findByIdAndDelete(id);
    if (!classDoc) throw new Error("Clase no encontrada");
    return { message: "Clase eliminada exitosamente" };
  },
};

// ══════════════════════════════════════════════════════
// DISPONIBILIDAD: empleado y salón
// ══════════════════════════════════════════════════════

/**
 * Verifica que el empleado no tenga otra sesión de clase en el mismo horario.
 */
async function assertEmployeeAvailable(employeeId, startDate, endDate, excludeSessionId = null) {
  const filter = {
    employeeId,
    status: { $nin: ["cancelled"] },
    startDate: { $lt: endDate },
    endDate: { $gt: startDate },
  };
  if (excludeSessionId) filter._id = { $ne: excludeSessionId };

  const conflict = await ClassSession.findOne(filter).populate("classId", "name");
  if (conflict) {
    throw new Error(
      `El instructor ya tiene la clase "${conflict.classId?.name || "otra clase"}" en ese horario`
    );
  }
}

/**
 * Verifica que el salón no tenga otra sesión en el mismo horario.
 */
async function assertRoomAvailable(roomId, startDate, endDate, excludeSessionId = null) {
  const filter = {
    roomId,
    status: { $nin: ["cancelled"] },
    startDate: { $lt: endDate },
    endDate: { $gt: startDate },
  };
  if (excludeSessionId) filter._id = { $ne: excludeSessionId };

  const conflict = await ClassSession.findOne(filter).populate("classId", "name");
  if (conflict) {
    throw new Error(
      `El salón ya tiene la clase "${conflict.classId?.name || "otra clase"}" en ese horario`
    );
  }
}

// ══════════════════════════════════════════════════════
// SESIONES (ClassSession)
// ══════════════════════════════════════════════════════

const sessionService = {
  async create(organizationId, data) {
    const { classId, employeeId, roomId, startDate, endDate, capacity, notes } = data;

    // Validar disponibilidad antes de crear
    await assertEmployeeAvailable(employeeId, startDate, endDate);
    await assertRoomAvailable(roomId, startDate, endDate);

    // Si no se indica capacidad, usar el default de la clase
    let sessionCapacity = capacity;
    if (!sessionCapacity) {
      const classDoc = await Class.findById(classId);
      if (!classDoc) throw new Error("Clase no encontrada");
      sessionCapacity = classDoc.defaultCapacity;
    }

    const session = new ClassSession({
      classId,
      organizationId,
      employeeId,
      roomId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      capacity: sessionCapacity,
      notes: notes || "",
    });

    return session.save();
  },

  async getByOrganization(organizationId, { from, to, classId, employeeId, roomId, status } = {}) {
    const filter = { organizationId };
    if (classId) filter.classId = classId;
    if (employeeId) filter.employeeId = employeeId;
    if (roomId) filter.roomId = roomId;
    if (status) filter.status = status;
    if (from || to) {
      filter.startDate = {};
      if (from) filter.startDate.$gte = new Date(from);
      if (to) filter.startDate.$lte = new Date(to);
    }

    return ClassSession.find(filter)
      .populate("classId", "name color pricePerPerson groupDiscount")
      .populate("employeeId", "names")
      .populate("roomId", "name capacity")
      .sort({ startDate: 1 });
  },

  async getById(id) {
    const session = await ClassSession.findById(id)
      .populate("classId")
      .populate("employeeId", "names")
      .populate("roomId", "name capacity");
    if (!session) throw new Error("Sesión no encontrada");
    return session;
  },

  /**
   * Sesiones disponibles para reserva pública (status=open, fecha futura).
   */
  async getAvailable(organizationId, { classId, from, to } = {}) {
    const filter = {
      organizationId,
      status: "open",
      startDate: { $gte: from ? new Date(from) : new Date() },
    };
    if (classId) filter.classId = classId;
    if (to) filter.startDate.$lte = new Date(to);

    return ClassSession.find(filter)
      .populate("classId", "name description color pricePerPerson groupDiscount duration")
      .populate("employeeId", "names")
      .populate("roomId", "name")
      .sort({ startDate: 1 });
  },

  async update(id, data) {
    const session = await ClassSession.findById(id);
    if (!session) throw new Error("Sesión no encontrada");

    const startDate = data.startDate ? new Date(data.startDate) : session.startDate;
    const endDate = data.endDate ? new Date(data.endDate) : session.endDate;
    const employeeId = data.employeeId || session.employeeId;
    const roomId = data.roomId || session.roomId;

    // Re-validar disponibilidad si cambia horario, instructor o salón
    const changed =
      data.startDate || data.endDate || data.employeeId || data.roomId;
    if (changed) {
      await assertEmployeeAvailable(employeeId, startDate, endDate, id);
      await assertRoomAvailable(roomId, startDate, endDate, id);
    }

    Object.assign(session, { ...data, startDate, endDate });
    return session.save();
  },

  async deleteSession(id) {
    const session = await ClassSession.findById(id);
    if (!session) throw new Error("Sesión no encontrada");

    await Enrollment.deleteMany({ sessionId: id });
    await ClassSession.findByIdAndDelete(id);

    return { message: "Sesión e inscripciones eliminadas correctamente" };
  },

  async deleteSessions(ids) {
    if (!ids?.length) throw new Error("Se requiere al menos una sesión");

    const objectIds = ids.map((id) => new Types.ObjectId(id));
    await Enrollment.deleteMany({ sessionId: { $in: objectIds } });
    const result = await ClassSession.deleteMany({ _id: { $in: objectIds } });

    return { deleted: result.deletedCount };
  },

  async cancel(id) {
    const session = await ClassSession.findById(id);
    if (!session) throw new Error("Sesión no encontrada");
    if (session.status === "cancelled") {
      throw new Error("La sesión ya está cancelada");
    }

    // Cancelar también todas las inscripciones pendientes/confirmadas
    await Enrollment.updateMany(
      { sessionId: id, status: { $in: ["pending", "confirmed"] } },
      { $set: { status: "cancelled", cancelledBy: "admin", cancelledAt: new Date() } }
    );

    // Nota: no decrementamos enrolledCount porque la sesión queda cancelada
    session.status = "cancelled";
    return session.save();
  },

  async markCompleted(id) {
    const session = await ClassSession.findById(id);
    if (!session) throw new Error("Sesión no encontrada");
    session.status = "completed";
    return session.save();
  },

  /**
   * Genera en bloque sesiones recurrentes para un período dado.
   *
   * @param {string} organizationId
   * @param {Object} data
   * @param {string}   data.classId
   * @param {string}   data.employeeId
   * @param {string}   data.roomId
   * @param {number[]} data.weekdays     - Días de la semana (0=Dom…6=Sáb)
   * @param {string}   data.time         - Hora de inicio "HH:MM" (timezone local de la org)
   * @param {string}   data.periodStart  - Fecha ISO inicio del período
   * @param {string}   data.periodEnd    - Fecha ISO fin del período
   * @param {string}   data.timezone     - Timezone de la organización
   * @param {number}   [data.capacity]   - Cupo por sesión (usa defaultCapacity si omitido)
   * @param {string}   [data.notes]
   * @returns {{ created: Object[], skipped: Object[] }}
   */
  async bulkCreate(organizationId, data) {
    const { classId, employeeId, roomId, weekdays, time, periodStart, periodEnd, timezone, capacity, notes } = data;

    if (!weekdays?.length) throw new Error("Debes seleccionar al menos un día de la semana");

    const classDoc = await Class.findById(classId);
    if (!classDoc) throw new Error("Clase no encontrada");

    const sessionCapacity = capacity || classDoc.defaultCapacity;
    const durationMin = classDoc.duration;

    // Parsear hora "HH:MM"
    const [startHour, startMinute] = time.split(":").map(Number);
    if (isNaN(startHour) || isNaN(startMinute)) throw new Error('Formato de hora inválido. Use "HH:MM"');

    // Construir lista de fechas candidatas en el período
    // Trabajamos en la timezone de la organización usando offsets manuales
    // para no depender de moment-timezone en este cálculo puntual
    const moment = (await import("moment-timezone")).default;

    const start = moment.tz(periodStart, timezone).startOf("day");
    const end   = moment.tz(periodEnd,   timezone).endOf("day");

    if (end.isBefore(start)) throw new Error("La fecha de fin debe ser posterior a la de inicio");

    const MAX_SESSIONS = 366; // límite de seguridad
    const candidates = [];
    const cursor = start.clone();

    while (cursor.isSameOrBefore(end) && candidates.length < MAX_SESSIONS) {
      // moment: 0=Dom, 1=Lun … 6=Sáb (igual que Date.getDay())
      if (weekdays.includes(cursor.day())) {
        const sessionStart = cursor.clone().hour(startHour).minute(startMinute).second(0).millisecond(0);
        const sessionEnd   = sessionStart.clone().add(durationMin, "minutes");
        candidates.push({ startDate: sessionStart.toDate(), endDate: sessionEnd.toDate() });
      }
      cursor.add(1, "day");
    }

    if (candidates.length === 0) {
      throw new Error("No se encontraron fechas válidas para el patrón indicado en el período seleccionado");
    }

    const created = [];
    const skipped = [];

    for (const { startDate, endDate } of candidates) {
      try {
        await assertEmployeeAvailable(employeeId, startDate, endDate);
        await assertRoomAvailable(roomId, startDate, endDate);

        const session = new ClassSession({
          classId, organizationId, employeeId, roomId,
          startDate, endDate,
          capacity: sessionCapacity,
          notes: notes || "",
        });
        await session.save();
        created.push(session);
      } catch (err) {
        skipped.push({ startDate, endDate, reason: err.message });
      }
    }

    return { created, skipped };
  },
};

export { roomService, classTypeService, sessionService };
