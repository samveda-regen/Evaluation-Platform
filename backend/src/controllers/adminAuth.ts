import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { generateAdminToken } from '../utils/jwt.js';
import { AuthenticatedRequest } from '../types/index.js';
import { sanitizeInput } from '../utils/sanitize.js';
import prisma from '../utils/db.js';

export async function registerAdmin(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { email, password, name } = req.body;

    const sanitizedEmail = sanitizeInput(email).toLowerCase();
    const sanitizedName = sanitizeInput(name);

    // Check if admin already exists
    const existingAdmin = await prisma.admin.findUnique({
      where: { email: sanitizedEmail }
    });

    if (existingAdmin) {
      res.status(400).json({ error: 'Admin with this email already exists' });
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create admin
    const admin = await prisma.admin.create({
      data: {
        email: sanitizedEmail,
        password: hashedPassword,
        name: sanitizedName
      }
    });

    const token = generateAdminToken({
      id: admin.id,
      email: admin.email,
      role: 'admin'
    });

    res.status(201).json({
      message: 'Admin registered successfully',
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name
      },
      token
    });
  } catch (error) {
    console.error('Admin registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function loginAdmin(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { email, password } = req.body;

    const sanitizedEmail = sanitizeInput(email).toLowerCase();

    // Find admin
    const admin = await prisma.admin.findUnique({
      where: { email: sanitizedEmail }
    });

    if (!admin) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, admin.password);

    if (!isValidPassword) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = generateAdminToken({
      id: admin.id,
      email: admin.email,
      role: 'admin'
    });

    res.json({
      message: 'Login successful',
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name
      },
      token
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getAdminProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const admin = await prisma.admin.findUnique({
      where: { id: req.admin!.id },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        _count: {
          select: { tests: true }
        }
      }
    });

    if (!admin) {
      res.status(404).json({ error: 'Admin not found' });
      return;
    }

    res.json({ admin });
  } catch (error) {
    console.error('Get admin profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
