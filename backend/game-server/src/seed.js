/**
 * Seed script: Populates DynamoDB tables with dictionary data (monsters, NPCs, items).
 * Also verifies in-memory data integrity.
 *
 * Usage:
 *   node src/seed.js            # Verify in-memory data
 *   USE_DYNAMODB=true node src/seed.js  # Seed DynamoDB tables
 */

const { MONSTERS, getAllMonsters } = require('./models/Monster');
const { NPCS, getAllNPCs } = require('./models/NPC');
const { ITEMS, getAllItems } = require('./models/Item');

async function seedDynamoDB() {
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

  const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-west-2',
  });
  const docClient = DynamoDBDocumentClient.from(client);

  console.log('Seeding DynamoDB tables...\n');

  // Seed Monsters
  console.log('--- Monsters ---');
  for (const monster of Object.values(MONSTERS)) {
    await docClient.send(
      new PutCommand({
        TableName: 'Monsters',
        Item: monster,
      })
    );
    console.log(`  [OK] ${monster.monster_id} - ${monster.name} (Lv.${monster.level})`);
  }

  // Seed NPCs
  console.log('\n--- NPCs ---');
  for (const npc of Object.values(NPCS)) {
    await docClient.send(
      new PutCommand({
        TableName: 'NPCs',
        Item: npc,
      })
    );
    console.log(`  [OK] ${npc.npc_id} - ${npc.name}`);
  }

  // Seed Items
  console.log('\n--- Items ---');
  for (const item of Object.values(ITEMS)) {
    await docClient.send(
      new PutCommand({
        TableName: 'Items',
        Item: item,
      })
    );
    console.log(`  [OK] ${item.item_id} - ${item.name} (${item.type})`);
  }

  console.log('\nDynamoDB seeding complete!');
}

function verifyInMemoryData() {
  console.log('Verifying in-memory dictionary data...\n');

  let errors = 0;

  // Verify Monsters
  console.log('--- Monsters ---');
  const monsters = getAllMonsters();
  console.log(`  Total: ${monsters.length}`);
  for (const m of monsters) {
    const ok =
      m.monster_id &&
      m.name &&
      m.level > 0 &&
      m.hp > 0 &&
      m.attack > 0 &&
      m.defense >= 0 &&
      m.exp_reward > 0 &&
      m.gold_reward > 0;

    if (!ok) {
      console.log(`  [FAIL] ${m.monster_id}: missing or invalid fields`);
      errors++;
    } else {
      console.log(`  [OK] ${m.monster_id} - ${m.name} (Lv.${m.level}) HP:${m.hp} ATK:${m.attack} DEF:${m.defense}`);
    }

    // Verify drop items reference valid item_ids
    for (const drop of m.drop_items || []) {
      if (!ITEMS[drop.item_id]) {
        console.log(`  [FAIL] ${m.monster_id} drops unknown item: ${drop.item_id}`);
        errors++;
      }
    }
  }

  // Verify NPCs
  console.log('\n--- NPCs ---');
  const npcs = getAllNPCs();
  console.log(`  Total: ${npcs.length}`);
  for (const n of npcs) {
    const ok = n.npc_id && n.name && n.role && n.personality;
    if (!ok) {
      console.log(`  [FAIL] ${n.npc_id}: missing fields`);
      errors++;
    } else {
      console.log(`  [OK] ${n.npc_id} - ${n.name} (${n.role.substring(0, 30)}...)`);
    }
  }

  // Verify Items
  console.log('\n--- Items ---');
  const items = getAllItems();
  console.log(`  Total: ${items.length}`);
  const itemsByType = {};
  for (const i of items) {
    const ok = i.item_id && i.name && i.type;
    if (!ok) {
      console.log(`  [FAIL] ${i.item_id}: missing fields`);
      errors++;
    } else {
      if (!itemsByType[i.type]) itemsByType[i.type] = [];
      itemsByType[i.type].push(i);
    }
  }

  for (const [type, typeItems] of Object.entries(itemsByType)) {
    console.log(`  ${type} (${typeItems.length}):`);
    for (const i of typeItems) {
      console.log(`    [OK] ${i.item_id} - ${i.name}`);
    }
  }

  // Verify gift pack references
  console.log('\n--- Gift Pack Cross-References ---');
  for (const item of items.filter((i) => i.type === 'gift_pack')) {
    const effect = item.effect || {};
    const contents = effect.contains || effect.random_one_of || [];
    for (const entry of contents) {
      if (!ITEMS[entry.item_id]) {
        console.log(`  [FAIL] ${item.item_id} references unknown item: ${entry.item_id}`);
        errors++;
      } else {
        console.log(`  [OK] ${item.item_id} -> ${entry.item_id}`);
      }
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`  Monsters: ${monsters.length}`);
  console.log(`  NPCs:     ${npcs.length}`);
  console.log(`  Items:    ${items.length}`);
  console.log(`  Errors:   ${errors}`);

  if (errors === 0) {
    console.log('\nAll dictionary data is valid!');
  } else {
    console.log(`\nFound ${errors} error(s). Please fix before deploying.`);
    process.exit(1);
  }
}

async function main() {
  // Always verify in-memory data
  verifyInMemoryData();

  // If USE_DYNAMODB is set, also seed DynamoDB
  if (process.env.USE_DYNAMODB === 'true') {
    console.log('\n========================================\n');
    await seedDynamoDB();
  } else {
    console.log('\nSkipping DynamoDB seeding (set USE_DYNAMODB=true to seed).');
  }
}

main().catch((err) => {
  console.error('Seed script failed:', err);
  process.exit(1);
});
