const router = require('express').Router();
const { query } = require('../config/db');
const { auth } = require('../middleware/auth');

// GET /api/folders
router.get('/', auth, async (req, res) => {
  try {
    const { parentId } = req.query;
    let folders;

    if (parentId) {
      folders = await query(
        'SELECT * FROM folders WHERE user_id = ? AND parent_id = ? ORDER BY name ASC',
        [req.user.id, parentId]
      );
    } else {
      folders = await query(
        'SELECT * FROM folders WHERE user_id = ? AND parent_id IS NULL ORDER BY name ASC',
        [req.user.id]
      );
    }

    res.json({ folders });
  } catch (err) {
    console.error('List folders error:', err);
    res.status(500).json({ message: 'Failed to list folders' });
  }
});

// POST /api/folders
router.post('/', auth, async (req, res) => {
  try {
    const { name, parentId } = req.body;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ message: 'Folder name is required' });
    }

    // Verify parent belongs to user
    if (parentId) {
      const parent = await query('SELECT id FROM folders WHERE id = ? AND user_id = ?', [parentId, req.user.id]);
      if (parent.length === 0) {
        return res.status(404).json({ message: 'Parent folder not found' });
      }
    }

    const result = await query(
      'INSERT INTO folders (user_id, parent_id, name) VALUES (?, ?, ?)',
      [req.user.id, parentId || null, name.trim()]
    );

    res.status(201).json({ id: result.insertId, name: name.trim(), parentId: parentId || null });
  } catch (err) {
    console.error('Create folder error:', err);
    res.status(500).json({ message: 'Failed to create folder' });
  }
});

// GET /api/folders/:id/path — get breadcrumb path
router.get('/:id/path', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const path = [];
    let currentId = id;

    // Walk up the tree
    while (currentId) {
      const folders = await query('SELECT * FROM folders WHERE id = ? AND user_id = ?', [currentId, req.user.id]);
      if (folders.length === 0) break;
      path.unshift({ id: folders[0].id, name: folders[0].name });
      currentId = folders[0].parent_id;
    }

    res.json({ path });
  } catch (err) {
    console.error('Folder path error:', err);
    res.status(500).json({ message: 'Failed to get folder path' });
  }
});

// DELETE /api/folders/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    const folders = await query('SELECT id FROM folders WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (folders.length === 0) {
      return res.status(404).json({ message: 'Folder not found' });
    }

    // Cascade delete handles children
    await query('DELETE FROM folders WHERE id = ?', [id]);

    res.json({ message: 'Folder deleted' });
  } catch (err) {
    console.error('Delete folder error:', err);
    res.status(500).json({ message: 'Failed to delete folder' });
  }
});

module.exports = router;
