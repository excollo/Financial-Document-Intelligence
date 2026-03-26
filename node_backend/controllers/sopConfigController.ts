import { Request, Response } from "express";
import { SopConfig } from "../models/SopConfig";

/**
 * SOP Config Controller — CRUD + activate for tenant-specific SOP configurations.
 * All queries use req.tenantQuery() for mandatory tenant isolation.
 */

// GET /api/sop-configs — List all SOP configs for current tenant
export const listSopConfigs = async (req: Request, res: Response) => {
  try {
    const configs = await SopConfig.find({ ...req.tenantQuery() })
      .sort({ version: -1 })
      .lean();

    return res.json({ data: configs });
  } catch (error: any) {
    console.error("listSopConfigs error:", error);
    return res.status(500).json({
      error: "Failed to list SOP configs",
      code: "LIST_SOP_CONFIGS_FAILED",
    });
  }
};

// GET /api/sop-configs/active — Get the currently active SOP config
export const getActiveSopConfig = async (req: Request, res: Response) => {
  try {
    const config = await SopConfig.findOne({
      ...req.tenantQuery(),
      is_active: true,
    }).lean();

    if (!config) {
      return res.status(404).json({
        error: "No active SOP config found. Please create one first.",
        code: "NO_ACTIVE_SOP",
      });
    }

    return res.json({ data: config });
  } catch (error: any) {
    console.error("getActiveSopConfig error:", error);
    return res
      .status(500)
      .json({ error: "Failed to get active SOP config", code: "GET_ACTIVE_SOP_FAILED" });
  }
};

// GET /api/sop-configs/:id — Get a single SOP config by id
export const getSopConfig = async (req: Request, res: Response) => {
  try {
    const config = await SopConfig.findOne({
      ...req.tenantQuery(),
      id: req.params.id,
    }).lean();

    if (!config) {
      return res
        .status(404)
        .json({ error: "SOP config not found", code: "SOP_NOT_FOUND" });
    }

    return res.json({ data: config });
  } catch (error: any) {
    console.error("getSopConfig error:", error);
    return res
      .status(500)
      .json({ error: "Failed to get SOP config", code: "GET_SOP_FAILED" });
  }
};

// POST /api/sop-configs — Create a new SOP config
export const createSopConfig = async (req: Request, res: Response) => {
  try {
    const { name, sections, is_active } = req.body;

    if (!name || !sections || !Array.isArray(sections) || sections.length === 0) {
      return res.status(400).json({
        error: "name and sections (non-empty array) are required",
        code: "INVALID_SOP_BODY",
      });
    }

    // Calculate next version for this tenant
    const latestConfig = await SopConfig.findOne({ ...req.tenantQuery() })
      .sort({ version: -1 })
      .select("version")
      .lean();
    const nextVersion = latestConfig ? latestConfig.version + 1 : 1;

    // If this will be active, deactivate others
    if (is_active) {
      await SopConfig.updateMany(
        { ...req.tenantQuery(), is_active: true },
        { $set: { is_active: false } }
      );
    }

    const config = await SopConfig.create({
      tenant_id: req.tenantId,
      name,
      version: nextVersion,
      sections,
      is_active: is_active ?? true, // Default to active
    });

    return res.status(201).json({ data: config.toObject() });
  } catch (error: any) {
    console.error("createSopConfig error:", error);
    return res
      .status(500)
      .json({ error: "Failed to create SOP config", code: "CREATE_SOP_FAILED" });
  }
};

// PUT /api/sop-configs/:id — Update an existing SOP config
export const updateSopConfig = async (req: Request, res: Response) => {
  try {
    const { name, sections, is_active } = req.body;

    const config = await SopConfig.findOne({
      ...req.tenantQuery(),
      id: req.params.id,
    });

    if (!config) {
      return res
        .status(404)
        .json({ error: "SOP config not found", code: "SOP_NOT_FOUND" });
    }

    if (name) config.name = name;
    if (sections && Array.isArray(sections)) config.set("sections", sections);

    // Handle activation
    if (is_active === true) {
      // Deactivate all others first
      await SopConfig.updateMany(
        { ...req.tenantQuery(), is_active: true, _id: { $ne: config._id } },
        { $set: { is_active: false } }
      );
      config.is_active = true;
    } else if (is_active === false) {
      config.is_active = false;
    }

    await config.save();
    return res.json({ data: config.toObject() });
  } catch (error: any) {
    console.error("updateSopConfig error:", error);
    return res
      .status(500)
      .json({ error: "Failed to update SOP config", code: "UPDATE_SOP_FAILED" });
  }
};

// POST /api/sop-configs/:id/activate — Activate a specific SOP config
export const activateSopConfig = async (req: Request, res: Response) => {
  try {
    const config = await SopConfig.findOne({
      ...req.tenantQuery(),
      id: req.params.id,
    });

    if (!config) {
      return res
        .status(404)
        .json({ error: "SOP config not found", code: "SOP_NOT_FOUND" });
    }

    // Deactivate all others
    await SopConfig.updateMany(
      { ...req.tenantQuery(), is_active: true, _id: { $ne: config._id } },
      { $set: { is_active: false } }
    );

    config.is_active = true;
    await config.save();

    return res.json({
      message: `SOP config "${config.name}" (v${config.version}) is now active`,
      data: config.toObject(),
    });
  } catch (error: any) {
    console.error("activateSopConfig error:", error);
    return res.status(500).json({
      error: "Failed to activate SOP config",
      code: "ACTIVATE_SOP_FAILED",
    });
  }
};

// DELETE /api/sop-configs/:id — Delete a SOP config
export const deleteSopConfig = async (req: Request, res: Response) => {
  try {
    const config = await SopConfig.findOne({
      ...req.tenantQuery(),
      id: req.params.id,
    });

    if (!config) {
      return res
        .status(404)
        .json({ error: "SOP config not found", code: "SOP_NOT_FOUND" });
    }

    if (config.is_active) {
      return res.status(400).json({
        error: "Cannot delete the active SOP config. Activate another config first.",
        code: "DELETE_ACTIVE_SOP",
      });
    }

    await SopConfig.deleteOne({ _id: config._id });
    return res.json({ message: "SOP config deleted" });
  } catch (error: any) {
    console.error("deleteSopConfig error:", error);
    return res.status(500).json({
      error: "Failed to delete SOP config",
      code: "DELETE_SOP_FAILED",
    });
  }
};
