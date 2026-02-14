import Organization from "../models/organizationModel.js";
import bcrypt from "bcryptjs";

const organizationService = {
  // Crear una nueva organización
  createOrganization: async (organizationData) => {
    const {
      name,
      iconUrl,
      email,
      location,
      address,
      password,
      phoneNumber,
      role,
      instagramUrl,
      facebookUrl,
      whatsappUrl,
      tiktokUrl,
      isActive,
      referredCount,
      referredReward,
      serviceCount,
      serviceReward,
      openingHours,
      plan,
      clientIdWhatsapp,
      reservationPolicy,
      default_country,
      timezone,
      currency,
    } = organizationData;

    // Encriptar la contraseña antes de guardarla
    const hashedPassword = await bcrypt.hash(password, 10);

    const newOrganization = new Organization({
      name,
      iconUrl,
      email,
      location,
      address,
      password: hashedPassword,
      phoneNumber,
      role,
      isActive,
      instagramUrl,
      facebookUrl,
      whatsappUrl,
      tiktokUrl,
      referredCount: referredCount || 0,
      referredReward: referredReward || null,
      serviceCount: serviceCount || 0,
      serviceReward: serviceReward || null,
      openingHours: openingHours || { start: null, end: null },
      plan,
      clientIdWhatsapp,
      branding: organizationData.branding || {},
      domains: organizationData.domains || [],
      reservationPolicy:
        reservationPolicy === "auto_if_available"
          ? "auto_if_available"
          : "manual",
      default_country: default_country || 'CO', // 🌍 País por defecto
      timezone: timezone || undefined,
      currency: currency || undefined,
    });

    const savedOrganization = await newOrganization.save();

    // Ocultar el campo password antes de devolver la organización creada
    savedOrganization.password = undefined;
    return savedOrganization;
  },

  // Obtener todas las organizaciones
  getOrganizations: async () => {
    return await Organization.find()
      .select("-password")
      .populate("role")
      .exec();
  },

  // Obtener una organización por ID
  getOrganizationById: async (id) => {
    const organization = await Organization.findById(id)
      .select("-password")
      .populate("role");
    if (!organization) {
      throw new Error("Organización no encontrada");
    }
    return organization;
  },

  // Actualizar una organización
  updateOrganization: async (id, organizationData) => {
    const {
      name,
      iconUrl,
      email,
      location,
      address,
      password,
      phoneNumber,
      role,
      instagramUrl,
      facebookUrl,
      whatsappUrl,
      tiktokUrl,
      isActive,
      referredCount,
      referredReward,
      serviceCount,
      serviceReward,
      openingHours,
      plan,
      clientIdWhatsapp,
      branding,
      domain,
      domains,
      reservationPolicy,
      showLoyaltyProgram,
      enableOnlineBooking,
      welcomeTitle,
      welcomeDescription,
      homeLayout,
      reminderSettings,
      paymentMethods,
      requireReservationDeposit,
      reservationDepositPercentage,
      default_country,
      timezone,
      currency,
      cancellationPolicy,
      blockHolidaysForReservations,
      allowedHolidayDates,
      hasAccessBlocked,
    } = organizationData;

    const organization = await Organization.findById(id);

    if (!organization) {
      throw new Error("Organización no encontrada");
    }

    // Actualizar los campos que se proporcionen en la solicitud
    organization.name = name !== undefined ? name : organization.name;
    organization.iconUrl =
      iconUrl !== undefined ? iconUrl : organization.iconUrl;
    organization.email = email !== undefined ? email : organization.email;
    organization.location =
      location !== undefined ? location : organization.location;
    organization.address =
      address !== undefined ? address : organization.address;
    organization.phoneNumber =
      phoneNumber !== undefined ? phoneNumber : organization.phoneNumber;
    organization.role = role !== undefined ? role : organization.role;
    organization.instagramUrl =
      instagramUrl !== undefined ? instagramUrl : organization.instagramUrl;
    organization.facebookUrl =
      facebookUrl !== undefined ? facebookUrl : organization.facebookUrl;
    organization.whatsappUrl =
      whatsappUrl !== undefined ? whatsappUrl : organization.whatsappUrl;
    organization.tiktokUrl =
      tiktokUrl !== undefined ? tiktokUrl : organization.tiktokUrl;
    organization.isActive =
      isActive !== undefined ? isActive : organization.isActive;

    organization.referredCount =
      referredCount !== undefined ? referredCount : organization.referredCount;
    organization.referredReward =
      referredReward !== undefined
        ? referredReward
        : organization.referredReward;
    organization.serviceCount =
      serviceCount !== undefined ? serviceCount : organization.serviceCount;
    organization.serviceReward =
      serviceReward !== undefined ? serviceReward : organization.serviceReward;
    if (openingHours !== undefined) {
      organization.openingHours = {
        ...(organization.openingHours?.toObject?.() ??
          organization.openingHours),
        ...openingHours,
      };
    }

    organization.plan = plan !== undefined ? plan : organization.plan;
    organization.clientIdWhatsapp =
      clientIdWhatsapp !== undefined
        ? clientIdWhatsapp
        : organization.clientIdWhatsapp;

    if (branding) {
      organization.branding = {
        ...organization.branding,
        ...branding,
      };
    }

    if (domains !== undefined) {
      organization.domains = Array.isArray(domains) ? domains : [domains];
    } else if (domain !== undefined) {
      organization.domains = Array.isArray(domain) ? domain : [domain];
    }

    if (reservationPolicy !== undefined) {
      if (!["manual", "auto_if_available"].includes(reservationPolicy)) {
        throw new Error("reservationPolicy inválida");
      }
      organization.reservationPolicy = reservationPolicy;
    }

    if (showLoyaltyProgram !== undefined) {
      organization.showLoyaltyProgram = showLoyaltyProgram;
    }

    if (enableOnlineBooking !== undefined) {
      organization.enableOnlineBooking = enableOnlineBooking;
    }

    if (welcomeTitle !== undefined) {
      organization.welcomeTitle = welcomeTitle;
    }

    if (welcomeDescription !== undefined) {
      organization.welcomeDescription = welcomeDescription;
    }

    if (homeLayout !== undefined) {
      organization.homeLayout = homeLayout;
    }

    if (reminderSettings !== undefined) {
      organization.reminderSettings = {
        ...organization.reminderSettings,
        ...reminderSettings,
      };
    }

    if (paymentMethods !== undefined) {
      organization.paymentMethods = paymentMethods;
    }

    if (requireReservationDeposit !== undefined) {
      organization.requireReservationDeposit = requireReservationDeposit;
    }

    if (reservationDepositPercentage !== undefined) {
      organization.reservationDepositPercentage = reservationDepositPercentage;
    }

    // 🌍 Actualizar país por defecto
    if (default_country !== undefined) {
      organization.default_country = default_country;
    }

    // 🕐 Actualizar zona horaria si se proporciona
    if (timezone !== undefined) {
      organization.timezone = timezone;
    }

    // 💱 Actualizar moneda si se proporciona
    if (currency !== undefined) {
      organization.currency = currency;
    }

    // 🚫 Actualizar política de cancelación si se proporciona
    if (cancellationPolicy !== undefined) {
      organization.cancellationPolicy = {
        ...organization.cancellationPolicy,
        ...cancellationPolicy,
      };
    }

    // 📅 Bloqueo de festivos para reservas online
    if (blockHolidaysForReservations !== undefined) {
      organization.blockHolidaysForReservations = blockHolidaysForReservations;
    }

    if (allowedHolidayDates !== undefined) {
      organization.allowedHolidayDates = allowedHolidayDates;
    }

    // 🔒 Bloqueo de acceso (superadmin)
    if (hasAccessBlocked !== undefined) {
      organization.hasAccessBlocked = hasAccessBlocked;
    }

    // Encriptar la contraseña solo si se proporciona una nueva
    if (password) {
      organization.password = await bcrypt.hash(password, 10);
    }

    const updatedOrganization = await organization.save();

    // Popular el campo 'role'
    await updatedOrganization.populate("role");

    // Ocultar la contraseña antes de devolver
    updatedOrganization.password = undefined;
    return updatedOrganization;
  },

  // Eliminar una organización
  deleteOrganization: async (id) => {
    const organization = await Organization.findById(id);
    if (!organization) {
      throw new Error("Organización no encontrada");
    }

    await Organization.deleteOne({ _id: id });
    return { message: "Organización eliminada correctamente" };
  },
};

export default organizationService;
